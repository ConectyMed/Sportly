import { Trash2, X } from 'lucide-react'
import { useState } from 'react'
import { foodItemName, mealDisplayName, rescaleItem, withItems } from '@/coach/food/foodAnalysis'
import { Button } from '@/components/ui/Button'
import { Chip } from '@/components/ui/Chip'
import { Stepper } from '@/components/ui/Primitives'
import { Sheet } from '@/components/ui/Sheet'
import { MEAL_SLOTS, mealSlotLabel } from '@/domain/labels'
import type { LoggedMeal } from '@/domain/types'
import { useT } from '@/i18n/react'
import { round } from '@/lib/utils'
import { userAction } from '@/coach/userActions'
import { useStore } from '@/store/useStore'

/** Edit a logged meal in place: portion, slot, items. Writes straight to the shared store. */
export function MealEditSheet({ mealId, onClose }: { mealId: string | null; onClose: () => void }) {
  const tr = useT()
  const meal = useStore((s) => (mealId ? s.meals[mealId] : undefined))
  return (
    <Sheet open={Boolean(mealId && meal)} onClose={onClose} title={meal ? mealDisplayName(meal, tr.lang) : tr.t('food.meal')}>
      {meal && <MealEditor key={meal.id} meal={meal} onClose={onClose} />}
    </Sheet>
  )
}

function MealEditor({ meal, onClose }: { meal: LoggedMeal; onClose: () => void }) {
  const tr = useT()
  // Same tools as the coach: validated, audited, idempotent.
  const upsertMeal = (m: LoggedMeal) => userAction({ type: 'update_meal', meal: m })
  const deleteMeal = (mealId: string) => userAction({ type: 'delete_meal', mealId })
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
            <div className="text-[12px] text-text-3 mb-2">{tr.t('nutrition.portionEaten')}</div>
            <div className="flex items-center justify-between gap-3">
              <Stepper value={scale} onChange={applyScale} min={25} max={300} step={25} unit="%" />
              <div className="text-right">
                <div className="text-[20px] font-semibold tabular title">{tr.int(meal.calories)}</div>
                <div className="text-[11px] text-text-3">{tr.t('common.kcal')} · {tr.t('common.gProtein', { n: meal.proteinG })}</div>
              </div>
            </div>
          </div>
          <div>
            <div className="text-[12px] text-text-3 mb-2">{tr.t('food.meal')}</div>
            <div className="flex flex-wrap gap-1.5">
              {MEAL_SLOTS.map((s) => (
                <Chip key={s} size="sm" selected={meal.slot === s} onClick={() => upsertMeal({ ...meal, slot: s, updatedAt: new Date().toISOString() })}>
                  {mealSlotLabel(s)}
                </Chip>
              ))}
            </div>
          </div>
          <div>
            <div className="text-[12px] text-text-3 mb-2">{tr.t('nutrition.items')}</div>
            <ul className="space-y-1.5">
              {meal.items.map((i) => {
                const name = foodItemName(i, tr.lang)
                return (
                  <li key={i.id} className="flex items-center gap-2 text-[14px]">
                    <span className="flex-1 truncate">{name}</span>
                    <span className="text-[12px] text-text-3 tabular">
                      {i.grams} {tr.t('common.g')} · {i.calories} {tr.t('common.kcal')}
                    </span>
                    <button
                      aria-label={tr.t('nutrition.removeItem', { name })}
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
                )
              })}
            </ul>
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" full onClick={onClose}>
              {tr.t('common.done')}
            </Button>
            <Button
              variant="danger"
              icon={<Trash2 size={15} />}
              onClick={() => {
                deleteMeal(meal.id)
                onClose()
              }}
            >
              {tr.t('common.remove')}
            </Button>
          </div>
        </div>
  )
}
