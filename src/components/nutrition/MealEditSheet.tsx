import { Trash2, X } from 'lucide-react'
import { useState } from 'react'
import { rescaleItem, withItems } from '@/coach/food/foodAnalysis'
import { Button } from '@/components/ui/Button'
import { Chip } from '@/components/ui/Chip'
import { Stepper } from '@/components/ui/Primitives'
import { Sheet } from '@/components/ui/Sheet'
import { MEAL_SLOT_LABELS } from '@/domain/labels'
import type { LoggedMeal } from '@/domain/types'
import { round } from '@/lib/utils'
import { useStore } from '@/store/useStore'

const SLOTS: Array<LoggedMeal['slot']> = ['breakfast', 'lunch', 'dinner', 'snack', 'pre_workout', 'post_workout']

/** Edit a logged meal in place: portion, slot, items. Writes straight to the shared store. */
export function MealEditSheet({ mealId, onClose }: { mealId: string | null; onClose: () => void }) {
  const meal = useStore((s) => (mealId ? s.meals[mealId] : undefined))
  return (
    <Sheet open={Boolean(mealId && meal)} onClose={onClose} title={meal?.name ?? 'Meal'}>
      {meal && <MealEditor key={meal.id} meal={meal} onClose={onClose} />}
    </Sheet>
  )
}

function MealEditor({ meal, onClose }: { meal: LoggedMeal; onClose: () => void }) {
  const upsertMeal = useStore((s) => s.upsertMeal)
  const deleteMeal = useStore((s) => s.deleteMeal)
  // Keyed by meal id, so the portion stepper starts at 100% for each meal opened.
  const [scale, setScale] = useState(100)

  const applyScale = (pct: number) => {
    const factor = pct / scale
    setScale(pct)
    upsertMeal(withItems(meal, meal.items.map((i) => rescaleItem(i, Math.max(5, i.grams * factor))), { portionScale: round(meal.portionScale * factor, 2) }))
  }

  return (
        <div className="space-y-5 pb-2" data-testid="meal-edit-sheet">
          <div>
            <div className="text-[12px] text-text-3 mb-2">Portion eaten</div>
            <div className="flex items-center justify-between gap-3">
              <Stepper value={scale} onChange={applyScale} min={25} max={300} step={25} unit="%" />
              <div className="text-right">
                <div className="text-[20px] font-semibold tabular title">{meal.calories.toLocaleString()}</div>
                <div className="text-[11px] text-text-3">kcal · {meal.proteinG} g protein</div>
              </div>
            </div>
          </div>
          <div>
            <div className="text-[12px] text-text-3 mb-2">Meal</div>
            <div className="flex flex-wrap gap-1.5">
              {SLOTS.map((s) => (
                <Chip key={s} size="sm" selected={meal.slot === s} onClick={() => upsertMeal({ ...meal, slot: s, updatedAt: new Date().toISOString() })}>
                  {MEAL_SLOT_LABELS[s]}
                </Chip>
              ))}
            </div>
          </div>
          <div>
            <div className="text-[12px] text-text-3 mb-2">Items</div>
            <ul className="space-y-1.5">
              {meal.items.map((i) => (
                <li key={i.id} className="flex items-center gap-2 text-[14px]">
                  <span className="flex-1 truncate">{i.name}</span>
                  <span className="text-[12px] text-text-3 tabular">
                    {i.grams} g · {i.calories} kcal
                  </span>
                  <button
                    aria-label={`Remove ${i.name}`}
                    onClick={() => {
                      const items = meal.items.filter((x) => x.id !== i.id)
                      if (!items.length) {
                        deleteMeal(meal.id)
                        onClose()
                      } else upsertMeal(withItems(meal, items))
                    }}
                    className="h-7 w-7 rounded-full text-text-4 hover:text-danger flex items-center justify-center"
                  >
                    <X size={13} />
                  </button>
                </li>
              ))}
            </ul>
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" full onClick={onClose}>
              Done
            </Button>
            <Button
              variant="danger"
              icon={<Trash2 size={15} />}
              onClick={() => {
                deleteMeal(meal.id)
                onClose()
              }}
            >
              Remove
            </Button>
          </div>
        </div>
  )
}
