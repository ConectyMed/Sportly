-- V8c — label matching.
--
-- Additive only: one extension, one index, one function, one table. Nothing
-- from 0001–0003 is altered. Still reference data plus one kind of user
-- content: a subject's own confirmed food corrections, scoped by subject_id
-- exactly as sportly_foods scopes them.
--
-- What V8b left exact, this makes approximate on purpose, but never guessing:
--
--   pg_trgm      trigram similarity over ciqual_foods.name_fr_norm, the same
--                normal form exact matching uses. Ciqual's own labels are the
--                index; the vocabulary a vision model emits ("pomme", "poulet
--                grillé") is the query. Two measures, two jobs:
--                  similarity(q, label)       how much of the whole label the
--                                             query explains — the confidence
--                  word_similarity(q, label)  how well the query appears
--                                             somewhere in the label — the
--                                             candidate gate
--                The thresholds live in server/nutrition/matching.ts and are
--                passed into the query; this file only makes them computable.
--
--   synonyms     free text → one canonical food (a Ciqual row or a Sportly
--                row). This is where a user's correction lands and where it is
--                reused: an exact hit here wins over any similarity score.

set client_encoding = 'UTF8';

-- ---------------------------------------------------------------------------
-- pg_trgm. Available on Neon and on a plain postgres:16 container alike;
-- `if not exists` keeps a re-run harmless and a pre-provisioned extension
-- (Neon installs it per database on request) from failing the migration.

create extension if not exists pg_trgm;

-- The index similarity search needs: GIN over trigrams of the normalised
-- French label. It serves the `<%` (word_similarity) and `%` (similarity)
-- operators the resolver's query is written with. The English label is not
-- indexed and not searched by similarity: the vocabulary being matched is
-- French, and "orange" landing on "Orange juice" would be noise, not recall.
create index if not exists ciqual_foods_name_fr_trgm
  on ciqual_foods using gin (name_fr_norm gin_trgm_ops);

-- ---------------------------------------------------------------------------
-- The food's name, as Ciqual writes labels: "<name>, <qualifier>, <qualifier>"
-- with the occasional "(aliment moyen)" or "(par ex. : …)" aside. The part
-- before the first comma, minus any parenthetical, is what a label calls the
-- food; the rest says how it was prepared. Candidates are ranked by how well
-- the query matches this name first, so "Banane, chair sans peau, crue" sits
-- above "Nectar de banane" for "banane" even though the nectar's label is the
-- shorter one. Ranking only: the bands are decided on the whole label.
create or replace function sportly_label_head(label_norm text) returns text
language sql immutable strict parallel safe as $$
  select trim(regexp_replace(split_part(label_norm, ',', 1), '\s*\(.*$', ''))
$$;

comment on function sportly_label_head(text) is
  'The food name a Ciqual-style label starts with: the text before the first comma, without a trailing parenthetical. Used to rank similarity candidates, never to decide a band.';

-- ---------------------------------------------------------------------------
-- Synonyms: one free-text term → one canonical food.
--
-- Shared rows (origin = sportly, subject_id null) are the seed under
-- data/food-matching/synonyms.fr.json, each one there because the test set
-- proved similarity alone could not put the right food in front of the user.
-- Correction rows (origin = user_correction) belong to one subject and are
-- consulted before shared rows for that subject only.
--
-- A term points at exactly one target: a Ciqual food (Licence Ouverte, the
-- join is allowed) or a Sportly food. There is deliberately no column for an
-- Open Food Facts product; that schema stays unreferenced.
create table if not exists sportly_food_synonyms (
  term               text          not null,
  term_norm          text          generated always as (sportly_label_norm(term)) stored,
  ciqual_alim_code   integer       references ciqual_foods (alim_code) on delete cascade,
  sportly_food_id    text          references sportly_foods (food_id) on delete cascade,
  origin             text          not null check (origin in ('sportly', 'user_correction')),
  subject_id         uuid,
  -- One row per (term, scope): a subject's own row and the shared row may
  -- both exist for the same term, two shared rows may not.
  scope              text          generated always as (coalesce(subject_id::text, 'shared')) stored,
  created_at         timestamptz   not null,
  updated_at         timestamptz   not null,
  primary key (term_norm, scope),
  constraint sportly_food_synonyms_one_target
    check ((ciqual_alim_code is null) <> (sportly_food_id is null)),
  constraint sportly_food_synonyms_correction_has_subject
    check ((origin = 'user_correction') = (subject_id is not null))
);

create index if not exists sportly_food_synonyms_subject
  on sportly_food_synonyms (subject_id) where subject_id is not null;

comment on table sportly_food_synonyms is
  'Free-text food terms mapped to one canonical food each (a Ciqual row or a Sportly row). Shared rows are the seed; user_correction rows are one subject''s confirmed corrections. Matched exactly on sportly_label_norm and consulted before any similarity search.';
