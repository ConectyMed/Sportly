import { ArrowRight, Camera, Minus, Plus, X } from 'lucide-react'
import { useNavigate } from 'react-router'
import { confidenceLabel, rescaleItem, withItems } from '@/coach/food/foodAnalysis'
import { Button } from '@/components/ui/Button'
import { Chip, Tag } from '@/components/ui/Chip'
import { MEAL_SLOT_LABELS } from '@/domain/labels'
import type { CoachCard, FoodItem, LoggedMeal } from '@/domain/types'
import { cn } from '@/lib/utils'
import { userAction } from '@/coach/userActions'
import { useStore } from '@/store/useStore'

const frame = 'rounded-[20px] border border-border bg-surface overflow-hidden'
const SLOTS: Array<LoggedMeal['slot']> = ['breakfast', 'lunch', 'dinner', 'snack']

function portionText(i: FoodItem): string {
  if (i.unit === 'g' || i.unit === 'ml') return `${i.grams} ${i.unit}`
  const unit = i.unit === 'piece' ? '' : ` ${i.unit}${i.quantity === 1 ? '' : 's'}`
  return `${Number.isInteger(i.quantity) ? i.quantity : i.quantity.toFixed(1)}${unit} · ${i.grams} g`
}

/**
 * The meal the coach estimated. It reads live from the store, so corrections
 * made in chat and edits made here always show the same numbers.
 */
export function FoodCardView({ card, onSend }: { card: CoachCard; onSend?: (text: string) => void }) {
  const navigate = useNavigate()
  const meal = useStore((s) => (card.refId ? s.meals[card.refId] : undefined))
  // Edits go through the same tools the coach uses (validated, audited, never duplicated).
  const upsertMeal = (m: LoggedMeal) => userAction({ type: 'update_meal', meal: m })
  const deleteMeal = (mealId: string) => userAction({ type: 'delete_meal', mealId })
  const activeConversationId = useStore((s) => s.activeConversationId)
  const updateConversationContext = useStore((s) => s.updateConversationContext)

  if (!meal) return <div className={cn(frame, 'p-4 text-[13px] text-text-3')}>This meal was removed.</div>

  const draft = meal.status === 'draft'
  const conf = confidenceLabel(meal.confidence)
  const focus = () => {
    if (activeConversationId) updateConversationContext(activeConversationId, { lastMealId: meal.id, topic: 'nutrition' })
  }
  const scaleItem = (item: FoodItem, factor: number) => {
    focus()
    upsertMeal(withItems(meal, meal.items.map((i) => (i.id === item.id ? rescaleItem(i, Math.max(5, i.grams * factor)) : i))))
  }
  const removeItem = (item: FoodItem) => {
    focus()
    const items = meal.items.filter((i) => i.id !== item.id)
    if (!items.length) {
      deleteMeal(meal.id)
      if (activeConversationId) updateConversationContext(activeConversationId, { lastMealId: undefined })
      return
    }
    upsertMeal(withItems(meal, items))
  }
  const setSlot = (slot: LoggedMeal['slot']) => {
    focus()
    upsertMeal({ ...meal, slot, updatedAt: new Date().toISOString() })
  }
  const commit = () => {
    focus()
    if (onSend) onSend(`Add it to ${MEAL_SLOT_LABELS[meal.slot].toLowerCase()}`)
    else upsertMeal({ ...meal, status: 'logged', updatedAt: new Date().toISOString() })
  }
  const discard = () => {
    deleteMeal(meal.id)
    if (activeConversationId) updateConversationContext(activeConversationId, { lastMealId: undefined })
  }

  return (
    <div className={frame} data-testid="food-card" data-status={meal.status}>
      <div className="p-4 pb-3">
        <div className="flex items-start gap-3">
          {meal.previewDataUrl ? (
            <img src={meal.previewDataUrl} alt="" className="h-14 w-14 rounded-[12px] object-cover shrink-0 border border-border" />
          ) : (
            <span className="h-14 w-14 rounded-[12px] bg-surface-2 text-text-3 flex items-center justify-center shrink-0">
              <Camera size={18} />
            </span>
          )}
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-2">
              <span className="label">{draft ? 'Estimated meal' : `Logged · ${MEAL_SLOT_LABELS[meal.slot]}`}</span>
              <Tag tone={conf === 'high' ? 'accent' : conf === 'medium' ? 'default' : 'warn'}>{conf} confidence</Tag>
            </div>
            <div className="title text-[18px] mt-0.5 truncate">{meal.name}</div>
            <div className="text-[12px] text-text-3 mt-0.5">{meal.analysis === 'vision' ? 'From your photo' : meal.analysis === 'manual' ? 'Entered by you' : 'Estimated from your description'}</div>
          </div>
        </div>

        <ul className="mt-3 space-y-1.5">
          {meal.items.map((i) => (
            <li key={i.id} className="flex items-center gap-2 text-[14px]">
              <div className="flex-1 min-w-0">
                <div className="truncate">{i.name}</div>
                <div className="text-[12px] text-text-3 tabular">
                  {portionText(i)} · {i.calories} kcal · {i.proteinG} g P
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button aria-label={`Less ${i.name}`} onClick={() => scaleItem(i, 0.75)} className="h-7 w-7 rounded-full bg-surface-2 text-text-2 hover:text-text flex items-center justify-center">
                  <Minus size={13} />
                </button>
                <button aria-label={`More ${i.name}`} onClick={() => scaleItem(i, 1.33)} className="h-7 w-7 rounded-full bg-surface-2 text-text-2 hover:text-text flex items-center justify-center">
                  <Plus size={13} />
                </button>
                <button aria-label={`Remove ${i.name}`} onClick={() => removeItem(i)} className="h-7 w-7 rounded-full text-text-4 hover:text-danger flex items-center justify-center">
                  <X size={13} />
                </button>
              </div>
            </li>
          ))}
        </ul>

        <div className="flex items-baseline gap-3 mt-3 pt-3 border-t border-border">
          <span className="title text-[22px] tabular">{meal.calories.toLocaleString()}</span>
          <span className="text-[12px] text-text-2">kcal</span>
          <span className="ml-auto flex gap-3 text-[12.5px] tabular text-text-2">
            <span>
              <b className="font-semibold text-text">{meal.proteinG} g</b> P
            </span>
            <span>
              <b className="font-semibold text-text">{meal.carbsG} g</b> C
            </span>
            <span>
              <b className="font-semibold text-text">{meal.fatG} g</b> F
            </span>
          </span>
        </div>
        {meal.notes?.[0] && <div className="text-[12.5px] text-text-3 mt-2">{meal.notes[0]}</div>}

        {draft && (
          <div className="flex gap-1.5 mt-3 overflow-x-auto no-scrollbar">
            {SLOTS.map((s) => (
              <Chip key={s} size="sm" selected={meal.slot === s} onClick={() => setSlot(s)}>
                {MEAL_SLOT_LABELS[s]}
              </Chip>
            ))}
          </div>
        )}
      </div>
      <div className="flex gap-2 p-3 pt-0">
        {draft ? (
          <>
            <Button size="sm" variant="primary" full onClick={commit}>
              Add to {MEAL_SLOT_LABELS[meal.slot].toLowerCase()}
            </Button>
            <Button size="sm" variant="secondary" onClick={discard}>
              Discard
            </Button>
          </>
        ) : (
          <Button size="sm" variant="secondary" full onClick={() => navigate('/nutrition')} iconRight={<ArrowRight size={14} />}>
            Today’s intake
          </Button>
        )}
      </div>
    </div>
  )
}
