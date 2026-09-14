import type { FoodUnit } from '@/domain/types'
import { foldText } from '@/lib/text'

/**
 * A compact nutrition reference: per-100 g macros, a sensible default portion,
 * and aliases for matching free text in English and French. Values are typical,
 * rounded figures. Ids and macros are language-independent; the English `name`
 * is the stored canonical, and screens render foodName(id) in the user's language.
 */
export interface FoodRef {
  id: string
  name: string
  aliases: string[]
  per100: { kcal: number; p: number; c: number; f: number; fiber?: number }
  /** Default grams for one serving when no quantity is given. */
  serving: number
  /** Grams per piece/slice/cup when countable. */
  pieceGrams?: number
  unitLabel?: FoodUnit
  category: 'protein' | 'carb' | 'veg' | 'fruit' | 'dairy' | 'fat' | 'sauce' | 'drink' | 'sweet' | 'mixed'
}

const f = (id: string, name: string, aliases: string[], per100: FoodRef['per100'], serving: number, category: FoodRef['category'], pieceGrams?: number, unitLabel?: FoodUnit): FoodRef => ({ id, name, aliases, per100, serving, category, pieceGrams, unitLabel })

export const FOODS: FoodRef[] = [
  // Proteins
  f('chicken_breast', 'Chicken breast', ['chicken', 'grilled chicken', 'chicken breast', 'poulet', 'blanc de poulet', 'poulet grillé', 'escalope de poulet', 'filet de poulet'], { kcal: 165, p: 31, c: 0, f: 3.6 }, 150, 'protein', 150, 'piece'),
  f('chicken_thigh', 'Chicken thigh', ['chicken thigh', 'thighs', 'cuisse de poulet', 'cuisses de poulet', 'haut de cuisse'], { kcal: 209, p: 26, c: 0, f: 11 }, 130, 'protein', 100, 'piece'),
  f('turkey', 'Turkey breast', ['turkey', 'dinde', 'escalope de dinde', 'blanc de dinde'], { kcal: 135, p: 30, c: 0, f: 1 }, 120, 'protein'),
  f('beef_steak', 'Steak', ['steak', 'beef', 'sirloin', 'ribeye', 'entrecote', 'boeuf', 'bœuf', 'bavette', 'rumsteck', 'faux-filet', 'viande rouge'], { kcal: 250, p: 26, c: 0, f: 16 }, 180, 'protein', 180, 'piece'),
  f('beef_mince', 'Lean beef mince', ['mince', 'ground beef', 'minced beef', 'burger patty', 'patty', 'steak haché', 'viande hachée', 'boeuf haché', 'bœuf haché', 'haché'], { kcal: 215, p: 26, c: 0, f: 12 }, 150, 'protein', 120, 'piece'),
  f('salmon', 'Salmon', ['salmon', 'saumon'], { kcal: 208, p: 20, c: 0, f: 13 }, 150, 'protein', 150, 'piece'),
  f('tuna', 'Tuna', ['tuna', 'thon'], { kcal: 130, p: 29, c: 0, f: 1 }, 120, 'protein'),
  f('white_fish', 'White fish', ['cod', 'fish', 'sea bass', 'haddock', 'tilapia', 'poisson', 'cabillaud', 'colin', 'bar', 'dorade', 'merlu', 'poisson blanc'], { kcal: 105, p: 23, c: 0, f: 1 }, 150, 'protein', 150, 'piece'),
  f('prawns', 'Prawns', ['prawns', 'shrimp', 'crevettes', 'gambas'], { kcal: 99, p: 24, c: 0, f: 0.3 }, 120, 'protein'),
  f('egg', 'Egg', ['egg', 'eggs', 'oeuf', 'oeufs', 'œuf', 'œufs', 'scrambled eggs', 'omelette', 'oeufs brouillés', 'œufs brouillés', 'oeuf dur', 'œuf dur'], { kcal: 155, p: 13, c: 1.1, f: 11 }, 100, 'protein', 50, 'piece'),
  f('tofu', 'Tofu', ['tofu'], { kcal: 76, p: 8, c: 1.9, f: 4.8 }, 150, 'protein'),
  f('tempeh', 'Tempeh', ['tempeh'], { kcal: 192, p: 20, c: 8, f: 11 }, 120, 'protein'),
  f('lentils', 'Lentils', ['lentils', 'lentilles', 'dal'], { kcal: 116, p: 9, c: 20, f: 0.4, fiber: 8 }, 150, 'protein'),
  f('chickpeas', 'Chickpeas', ['chickpeas', 'chickpea', 'hummus', 'pois chiches', 'pois chiche', 'houmous'], { kcal: 164, p: 9, c: 27, f: 2.6, fiber: 7 }, 120, 'protein'),
  f('black_beans', 'Beans', ['beans', 'black beans', 'kidney beans', 'haricots', 'haricots rouges', 'haricots noirs', 'haricots blancs'], { kcal: 132, p: 9, c: 24, f: 0.5, fiber: 8 }, 120, 'protein'),
  f('protein_shake', 'Protein shake', ['protein shake', 'whey', 'shake', 'protein powder', 'shaker', 'protéine en poudre', 'proteine en poudre', 'shake protéiné', 'shake proteine'], { kcal: 120, p: 24, c: 3, f: 1.5 }, 300, 'drink', 300, 'serving'),
  f('greek_yogurt', 'Greek yogurt', ['greek yogurt', 'yogurt', 'yoghurt', 'skyr', 'yaourt', 'yaourt grec', 'fromage blanc', 'petit suisse'], { kcal: 97, p: 9, c: 3.6, f: 5 }, 170, 'dairy'),
  f('cottage_cheese', 'Cottage cheese', ['cottage cheese'], { kcal: 98, p: 11, c: 3.4, f: 4.3 }, 150, 'dairy'),
  f('cheese', 'Cheese', ['cheese', 'cheddar', 'mozzarella', 'parmesan', 'feta', 'fromage', 'halloumi', 'paneer', 'comté', 'gruyère', 'emmental', 'chèvre', 'camembert'], { kcal: 380, p: 25, c: 1.3, f: 31 }, 30, 'dairy', 30, 'slice'),
  f('milk', 'Milk', ['milk', 'lait', 'oat milk', 'lait d’avoine', "lait d'avoine"], { kcal: 50, p: 3.4, c: 5, f: 1.7 }, 250, 'drink', 250, 'cup'),

  // Carbs
  f('rice', 'Rice', ['rice', 'riz', 'basmati', 'jasmine rice', 'white rice', 'brown rice', 'riz blanc', 'riz complet', 'riz basmati'], { kcal: 130, p: 2.7, c: 28, f: 0.3, fiber: 0.4 }, 180, 'carb', 180, 'cup'),
  f('pasta', 'Pasta', ['pasta', 'spaghetti', 'penne', 'pâtes', 'pates', 'noodles', 'tagliatelle', 'linguine', 'nouilles', 'coquillettes'], { kcal: 158, p: 5.8, c: 31, f: 0.9, fiber: 1.8 }, 200, 'carb', 200, 'cup'),
  f('potato', 'Potatoes', ['potato', 'potatoes', 'pommes de terre', 'pomme de terre', 'mashed potato', 'roast potatoes', 'purée', 'patates'], { kcal: 87, p: 1.9, c: 20, f: 0.1, fiber: 1.8 }, 200, 'carb', 170, 'piece'),
  f('sweet_potato', 'Sweet potato', ['sweet potato', 'patate douce', 'patates douces'], { kcal: 90, p: 2, c: 21, f: 0.2, fiber: 3 }, 200, 'carb', 180, 'piece'),
  f('fries', 'Fries', ['fries', 'chips', 'frites', 'french fries'], { kcal: 312, p: 3.4, c: 41, f: 15, fiber: 3.8 }, 150, 'carb'),
  f('bread', 'Bread', ['bread', 'toast', 'baguette', 'pain', 'sourdough', 'roll', 'bun', 'tartine', 'tartines', 'pain complet', 'pain grillé'], { kcal: 265, p: 9, c: 49, f: 3.2, fiber: 2.7 }, 60, 'carb', 30, 'slice'),
  f('wrap', 'Wrap', ['wrap', 'tortilla', 'burrito', 'galette'], { kcal: 300, p: 8, c: 50, f: 7 }, 70, 'carb', 70, 'piece'),
  f('oats', 'Oats', ['oats', 'oatmeal', 'porridge', 'flocons d’avoine', "flocons d'avoine", 'avoine', 'granola', 'muesli'], { kcal: 379, p: 13, c: 68, f: 6.5, fiber: 10 }, 60, 'carb'),
  f('quinoa', 'Quinoa', ['quinoa', 'couscous', 'bulgur', 'boulgour', 'semoule'], { kcal: 120, p: 4.4, c: 21, f: 1.9, fiber: 2.8 }, 180, 'carb', 180, 'cup'),
  f('pizza', 'Pizza', ['pizza'], { kcal: 266, p: 11, c: 33, f: 10 }, 250, 'mixed', 110, 'slice'),
  f('sushi', 'Sushi', ['sushi', 'maki', 'nigiri', 'sushis', 'makis'], { kcal: 150, p: 6, c: 28, f: 1.5 }, 240, 'mixed', 30, 'piece'),
  f('burger', 'Burger', ['burger', 'cheeseburger', 'hamburger'], { kcal: 260, p: 14, c: 25, f: 12 }, 220, 'mixed', 220, 'piece'),
  f('sandwich', 'Sandwich', ['sandwich', 'panini', 'jambon-beurre', 'jambon beurre'], { kcal: 240, p: 12, c: 28, f: 9 }, 220, 'mixed', 220, 'piece'),

  // Vegetables & fruit
  f('vegetables', 'Vegetables', ['vegetables', 'veg', 'veggies', 'légumes', 'legumes', 'broccoli', 'green beans', 'spinach', 'greens', 'courgette', 'zucchini', 'peppers', 'carrots', 'asparagus', 'bok choy', 'brocoli', 'haricots verts', 'épinards', 'epinards', 'courgettes', 'poivrons', 'carottes', 'asperges', 'ratatouille', 'chou-fleur', 'aubergine', 'aubergines'], { kcal: 35, p: 2.5, c: 6, f: 0.4, fiber: 3 }, 150, 'veg'),
  f('salad', 'Salad', ['salad', 'salade', 'lettuce', 'rocket', 'mixed leaves', 'salade verte', 'laitue', 'roquette', 'crudités', 'crudites'], { kcal: 20, p: 1.5, c: 3, f: 0.2, fiber: 1.5 }, 120, 'veg'),
  f('tomato', 'Tomatoes', ['tomato', 'tomatoes', 'tomate', 'tomates'], { kcal: 18, p: 0.9, c: 3.9, f: 0.2 }, 100, 'veg', 100, 'piece'),
  f('avocado', 'Avocado', ['avocado', 'avocat', 'guacamole'], { kcal: 160, p: 2, c: 9, f: 15, fiber: 7 }, 80, 'fat', 160, 'piece'),
  f('banana', 'Banana', ['banana', 'banane', 'bananes'], { kcal: 89, p: 1.1, c: 23, f: 0.3, fiber: 2.6 }, 120, 'fruit', 120, 'piece'),
  f('apple', 'Apple', ['apple', 'pomme', 'pommes'], { kcal: 52, p: 0.3, c: 14, f: 0.2, fiber: 2.4 }, 180, 'fruit', 180, 'piece'),
  f('berries', 'Berries', ['berries', 'blueberries', 'strawberries', 'raspberries', 'fruits rouges', 'fraises', 'framboises', 'myrtilles'], { kcal: 50, p: 0.7, c: 12, f: 0.3, fiber: 3 }, 100, 'fruit'),
  f('fruit', 'Fruit', ['fruit', 'orange', 'mango', 'pineapple', 'grapes', 'pear', 'melon', 'fruits', 'mangue', 'ananas', 'raisin', 'poire', 'clémentine', 'clementine', 'kiwi', 'pêche', 'peche', 'abricot'], { kcal: 55, p: 0.8, c: 13, f: 0.2, fiber: 2 }, 150, 'fruit'),

  // Fats, sauces, extras
  f('olive_oil', 'Olive oil', ['olive oil', 'oil', 'huile', "huile d'olive", 'huile d’olive'], { kcal: 884, p: 0, c: 0, f: 100 }, 10, 'fat', 14, 'tbsp'),
  f('butter', 'Butter', ['butter', 'beurre'], { kcal: 717, p: 0.9, c: 0.1, f: 81 }, 10, 'fat', 14, 'tbsp'),
  f('nuts', 'Nuts', ['nuts', 'almonds', 'walnuts', 'peanuts', 'cashews', 'noix', 'amandes', 'noisettes', 'cacahuètes', 'cacahuetes', 'noix de cajou', 'fruits à coque', 'fruits a coque'], { kcal: 607, p: 20, c: 21, f: 54, fiber: 7 }, 30, 'fat'),
  f('peanut_butter', 'Peanut butter', ['peanut butter', 'almond butter', 'nut butter', 'beurre de cacahuète', 'beurre de cacahuete', 'purée d’amande', "purée d'amande", 'puree d’amande'], { kcal: 588, p: 25, c: 20, f: 50, fiber: 6 }, 30, 'fat', 16, 'tbsp'),
  f('sauce', 'Sauce', ['sauce', 'gravy', 'teriyaki', 'curry sauce', 'pesto', 'tomato sauce', 'soy sauce', 'sauce tomate', 'sauce soja', 'ketchup'], { kcal: 120, p: 2, c: 12, f: 7 }, 50, 'sauce', 15, 'tbsp'),
  f('creamy_sauce', 'Creamy sauce', ['cream sauce', 'creamy', 'alfredo', 'carbonara sauce', 'cream', 'crème', 'creme', 'sauce crémeuse', 'crème fraîche', 'creme fraiche'], { kcal: 220, p: 3, c: 6, f: 21 }, 60, 'sauce', 15, 'tbsp'),
  f('mayo', 'Mayonnaise', ['mayo', 'mayonnaise', 'aioli', 'aïoli'], { kcal: 680, p: 1, c: 1, f: 75 }, 15, 'sauce', 15, 'tbsp'),
  f('dressing', 'Dressing', ['dressing', 'vinaigrette'], { kcal: 350, p: 0.5, c: 8, f: 35 }, 20, 'sauce', 15, 'tbsp'),
  f('curry', 'Curry', ['curry', 'tikka masala', 'korma', 'green curry', 'curry vert'], { kcal: 150, p: 9, c: 8, f: 9 }, 300, 'mixed'),
  f('soup', 'Soup', ['soup', 'soupe', 'broth', 'ramen', 'potage', 'velouté', 'veloute', 'bouillon'], { kcal: 55, p: 3, c: 7, f: 1.5 }, 350, 'mixed', 350, 'cup'),

  // Sweets & drinks
  f('chocolate', 'Chocolate', ['chocolate', 'chocolat', 'dark chocolate', 'chocolat noir'], { kcal: 546, p: 5, c: 61, f: 31 }, 30, 'sweet', 10, 'piece'),
  f('dessert', 'Dessert', ['dessert', 'cake', 'brownie', 'cookie', 'ice cream', 'tiramisu', 'cheesecake', 'gâteau', 'gateau', 'pastry', 'croissant', 'muffin', 'glace', 'pain au chocolat', 'tarte', 'crêpe', 'crepe', 'viennoiserie', 'biscuit', 'biscuits'], { kcal: 380, p: 5, c: 45, f: 20 }, 110, 'sweet', 110, 'piece'),
  f('honey', 'Honey', ['honey', 'jam', 'maple syrup', 'sugar', 'miel', 'confiture', 'sirop d’érable', "sirop d'erable", 'sucre'], { kcal: 304, p: 0.3, c: 82, f: 0 }, 20, 'sweet', 20, 'tbsp'),
  f('beer', 'Beer', ['beer', 'bière', 'biere', 'pint', 'demi', 'pinte'], { kcal: 43, p: 0.5, c: 3.6, f: 0 }, 500, 'drink', 500, 'serving'),
  f('wine', 'Wine', ['wine', 'vin', 'glass of wine', 'verre de vin', 'rosé', 'rose'], { kcal: 83, p: 0.1, c: 2.6, f: 0 }, 150, 'drink', 150, 'serving'),
  f('juice', 'Juice', ['juice', 'jus', 'orange juice', 'smoothie', "jus d'orange", 'jus d’orange', 'jus de fruit'], { kcal: 46, p: 0.7, c: 10, f: 0.2 }, 250, 'drink', 250, 'cup'),
  f('coffee', 'Coffee', ['coffee', 'café', 'cafe', 'latte', 'cappuccino', 'flat white', 'expresso', 'espresso', 'café au lait'], { kcal: 20, p: 1, c: 2, f: 1 }, 200, 'drink', 200, 'cup'),
]

export const FOOD_MAP: Record<string, FoodRef> = Object.fromEntries(FOODS.map((x) => [x.id, x]))

/** Aliases are matched accent-folded and lower case, longest first, so “sweet potato” beats “potato” and “patate douce” beats “patate”. */
const ALIASES: Array<{ alias: string; ref: FoodRef }> = FOODS.flatMap((ref) => ref.aliases.map((alias) => ({ alias: foldText(alias.toLowerCase().replace(/’/g, "'")), ref })))
  .filter((x, i, arr) => arr.findIndex((y) => y.alias === x.alias) === i)
  .sort((a, b) => b.alias.length - a.alias.length)

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

export function findFood(text: string): FoodRef | undefined {
  const t = foldText(text.toLowerCase().replace(/’/g, "'").trim())
  if (!t) return undefined
  for (const { alias, ref } of ALIASES) {
    if (t === alias || t === `${alias}s` || t === alias.replace(/s$/, '')) return ref
  }
  for (const { alias, ref } of ALIASES) {
    if (new RegExp(`(^|\\b)${esc(alias)}(s|es)?(\\b|$)`).test(t)) return ref
  }
  return undefined
}

/** All food references mentioned anywhere in a text, in order of appearance, without overlaps. Indexes refer to the input text. */
export function findFoodsInText(text: string): Array<{ ref: FoodRef; index: number; match: string }> {
  // foldText preserves length, so an index in the folded text is the same index in the original.
  const t = foldText(text.toLowerCase().replace(/’/g, "'"))
  const taken: Array<[number, number]> = []
  const out: Array<{ ref: FoodRef; index: number; match: string }> = []
  for (const { alias, ref } of ALIASES) {
    const re = new RegExp(`(^|[^a-z])(${esc(alias)}(?:s|es)?)(?![a-z])`, 'g')
    let m: RegExpExecArray | null
    while ((m = re.exec(t))) {
      const start = m.index + m[1].length
      const end = start + m[2].length
      if (taken.some(([a, b]) => start < b && end > a)) continue
      if (out.some((o) => o.ref.id === ref.id)) continue
      taken.push([start, end])
      out.push({ ref, index: start, match: text.slice(start, end) })
    }
  }
  return out.sort((a, b) => a.index - b.index)
}
