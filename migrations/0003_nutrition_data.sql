-- V8b — nutrition data layer.
--
-- Additive only: one schema, one function, five tables, no ALTER, and nothing
-- from 0001/0002 is touched. Everything here is reference data — food
-- composition — and none of it is user content.
--
-- Three sources, three homes, chosen by licence:
--
--   ciqual_foods      ANSES Ciqual 2025, Licence Ouverte 2.0 (Etalab). Free to
--                     reuse and to join with our own tables; attribution to
--                     ANSES is required and is what `ciqual_ingest` carries.
--
--   off.products      Open Food Facts, ODbL 1.0. Share-alike applies to any
--                     *derived database*, so this lives in its own schema and is
--                     a lookup cache, never a source for rows in `public`. No
--                     table in `public` references it and it references nothing
--                     in `public`; that separation is the containment.
--
--   sportly_foods     Ours. Typical portions, composed dishes, user-confirmed
--                     corrections, foods the other two do not cover.
--
-- The migration is UTF-8 and says so, because `sportly_label_norm` below spells
-- out accented characters and a client in another encoding would mangle them.

set client_encoding = 'UTF8';

-- ---------------------------------------------------------------------------
-- Label normalisation, in one place: the database.
--
-- Every label match in the resolver is *exact* on this normal form, computed
-- by the same function on the stored column (a generated column) and on the
-- incoming query (`= sportly_label_norm($1)`), so no TypeScript re-implements
-- it and the two can never drift. No `unaccent` extension: Neon and a plain
-- container do not agree on extensions, and a hand-written map is enough for
-- French and English food names.
--
-- Lower-case, accents folded, ligatures expanded, smart apostrophes
-- straightened, whitespace collapsed. Punctuation is kept: "pomme, crue" and
-- "pomme crue" are different labels, and the resolver never guesses.
create or replace function sportly_label_norm(label text) returns text
language sql immutable strict parallel safe as $$
  select regexp_replace(
    trim(
      lower(
        translate(
          replace(replace(replace(replace(replace(replace(label, 'œ', 'oe'), 'Œ', 'OE'), 'æ', 'ae'), 'Æ', 'AE'), '’', ''''), '‘', ''''),
          'ÀÁÂÃÄÅàáâãäåÈÉÊËèéêëÌÍÎÏìíîïÒÓÔÕÖØòóôõöøÙÚÛÜùúûüÇçÑñÝýÿŸ',
          'AAAAAAaaaaaaEEEEeeeeIIIIiiiiOOOOOOooooooUUUUuuuuCcNnYyyY'
        )
      )
    ),
    '\s+', ' ', 'g'
  )
$$;

comment on function sportly_label_norm(text) is
  'The one normal form every food label is compared in. Applied to stored names (generated columns) and to queries alike, so a match is exact by construction.';

-- ---------------------------------------------------------------------------
-- Ciqual (ANSES), Licence Ouverte 2.0.

create table if not exists ciqual_foods (
  alim_code          integer       primary key,
  name_fr            text          not null,
  name_en            text,
  -- Ciqual's own classification, kept as the codes it publishes.
  group_code         text,
  subgroup_code      text,
  subsubgroup_code   text,
  -- Per 100 g, as published. NULL means Ciqual gives no value ("-"). A value
  -- below the limit of quantification ("< 0,5") and "traces" are stored as 0;
  -- the raw strings stay in the snapshot file the ingest reads from.
  energy_kcal        numeric(9, 3),
  energy_kj          numeric(9, 3),
  protein_g          numeric(9, 3),
  carbs_g            numeric(9, 3),
  sugars_g           numeric(9, 3),
  fat_g              numeric(9, 3),
  saturated_fat_g    numeric(9, 3),
  fibre_g            numeric(9, 3),
  salt_g             numeric(9, 3),
  water_g            numeric(9, 3),
  ciqual_version     text          not null,
  ingested_at        timestamptz   not null,
  name_fr_norm       text          generated always as (sportly_label_norm(name_fr)) stored,
  name_en_norm       text          generated always as (sportly_label_norm(name_en)) stored
);

create index if not exists ciqual_foods_name_fr_norm on ciqual_foods (name_fr_norm);
create index if not exists ciqual_foods_name_en_norm on ciqual_foods (name_en_norm);

comment on table ciqual_foods is
  'ANSES Ciqual table, one row per food with the constituents the macro calculator needs. Source: Anses, Table de composition nutritionnelle des aliments Ciqual (ciqual.anses.fr), Licence Ouverte 2.0. Loaded by scripts/ingest-ciqual.mjs from the snapshot under data/ciqual/.';

-- One row per Ciqual version applied: where it came from, what it was, when.
-- This is the attribution record the UI is built from, and the proof of
-- provenance for the row count above.
create table if not exists ciqual_ingest (
  ciqual_version   text         primary key,
  dataset_doi      text         not null,
  dataset_url      text         not null,
  source_files     jsonb        not null,
  licence          text         not null,
  attribution      text         not null,
  fetched_at       timestamptz  not null,
  ingested_at      timestamptz  not null,
  food_count       integer      not null
);

comment on table ciqual_ingest is
  'Provenance of each Ciqual version loaded: DOI, dataset URL, file names and checksums, licence and the attribution line ANSES asks for.';

-- ---------------------------------------------------------------------------
-- Open Food Facts, ODbL 1.0 — its own schema.

create schema if not exists off;

comment on schema off is
  'Open Food Facts data (Open Database License 1.0, share-alike). A per-barcode lookup cache filled from the OFF API on demand — never the product dump. Kept apart from public on purpose: nothing in public references this schema, nothing here references public, and no table in public is ever derived from it.';

create table if not exists off.products (
  barcode               text          primary key,
  -- 'not_found' rows are cached too, so a barcode OFF does not know is not
  -- re-requested on every scan. They carry no product fields.
  status                text          not null check (status in ('found', 'not_found')),
  product_name          text,
  product_name_fr       text,
  brands                text,
  quantity              text,
  serving_size          text,
  serving_quantity_g    numeric(12, 4),
  -- Per 100 g, from `nutriments`. NULL when OFF has no value.
  energy_kcal_100g      numeric(12, 4),
  energy_kj_100g        numeric(12, 4),
  protein_g_100g        numeric(12, 4),
  carbs_g_100g          numeric(12, 4),
  sugars_g_100g         numeric(12, 4),
  fat_g_100g            numeric(12, 4),
  saturated_fat_g_100g  numeric(12, 4),
  fibre_g_100g          numeric(12, 4),
  salt_g_100g           numeric(12, 4),
  -- The `nutriments` object as OFF returned it, for fields not lifted above.
  nutriments            jsonb,
  last_modified_t       bigint,
  product_url           text,
  fetched_at            timestamptz   not null,
  http_status           integer       not null,
  constraint off_products_not_found_is_empty
    check (status = 'found' or (product_name is null and nutriments is null))
);

comment on table off.products is
  'One row per barcode looked up through the Open Food Facts API (world.openfoodfacts.org/api/v2), found or not. Refreshed when older than the cache TTL. © Open Food Facts contributors, ODbL 1.0.';

-- ---------------------------------------------------------------------------
-- Sportly's own foods.

create table if not exists sportly_foods (
  food_id            text          primary key,
  -- 'dish' is the placeholder for composed dishes. Their components get their
  -- own table (food_id → component, grams) with the scan session; nothing
  -- here has to change for that.
  kind               text          not null default 'ingredient' check (kind in ('ingredient', 'dish')),
  name_en            text          not null,
  name_fr            text,
  -- 'sportly' rows are shared reference data. 'user_correction' rows are
  -- confirmed by one subject and belong to that subject only.
  origin             text          not null check (origin in ('sportly', 'user_correction')),
  subject_id         uuid,
  -- A Ciqual food this row refines (a typical portion for it, say). Allowed:
  -- Licence Ouverte permits the join. There is deliberately no such column for
  -- an OFF product.
  ciqual_alim_code   integer       references ciqual_foods (alim_code) on delete set null,
  energy_kcal_100g   numeric(9, 3),
  protein_g_100g     numeric(9, 3),
  carbs_g_100g       numeric(9, 3),
  fat_g_100g         numeric(9, 3),
  fibre_g_100g       numeric(9, 3),
  typical_portion_g  numeric(9, 3),
  portion_unit       text          check (portion_unit in ('g', 'ml', 'piece', 'serving', 'cup', 'tbsp', 'slice')),
  portion_label      text,
  notes              text,
  created_at         timestamptz   not null,
  updated_at         timestamptz   not null,
  name_en_norm       text          generated always as (sportly_label_norm(name_en)) stored,
  name_fr_norm       text          generated always as (sportly_label_norm(name_fr)) stored,
  constraint sportly_foods_correction_has_subject
    check ((origin = 'user_correction') = (subject_id is not null))
);

create index if not exists sportly_foods_name_en_norm on sportly_foods (name_en_norm);
create index if not exists sportly_foods_name_fr_norm on sportly_foods (name_fr_norm);
create index if not exists sportly_foods_subject on sportly_foods (subject_id) where subject_id is not null;

comment on table sportly_foods is
  'Sportly''s own food table: typical portions, composed dishes (kind = dish, components to come), user-confirmed corrections (origin = user_correction, scoped by subject_id), and foods Ciqual and OFF do not cover.';

-- Aliases are one row each so the normal form is a generated column and the
-- uniqueness of (food, alias) is a constraint rather than a convention.
create table if not exists sportly_food_aliases (
  food_id     text  not null references sportly_foods (food_id) on delete cascade,
  alias       text  not null,
  alias_norm  text  generated always as (sportly_label_norm(alias)) stored,
  primary key (food_id, alias_norm)
);

create index if not exists sportly_food_aliases_norm on sportly_food_aliases (alias_norm);

comment on table sportly_food_aliases is
  'Labels a Sportly food answers to, in any language, matched exactly on sportly_label_norm.';
