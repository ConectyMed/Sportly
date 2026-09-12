import { cn } from '@/lib/utils'

export interface SliderProps {
  label?: string
  value: number
  min?: number
  max?: number
  step?: number
  onChange: (v: number) => void
  leftLabel?: string
  rightLabel?: string
  format?: (v: number) => string
  className?: string
}

export function Slider({ label, value, min = 0, max = 100, step = 1, onChange, leftLabel, rightLabel, format, className }: SliderProps) {
  const pct = ((value - min) / (max - min)) * 100
  return (
    <div className={cn('w-full', className)}>
      {(label || format) && (
        <div className="flex items-baseline justify-between mb-1">
          {label && <span className="text-[15px] font-medium">{label}</span>}
          {format && <span className="text-[13px] text-text-2 tabular">{format(value)}</span>}
        </div>
      )}
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-label={label}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{ ['--fill' as string]: `${pct}%` }}
      />
      {(leftLabel || rightLabel) && (
        <div className="flex justify-between text-[12px] text-text-3 -mt-1">
          <span>{leftLabel}</span>
          <span>{rightLabel}</span>
        </div>
      )}
    </div>
  )
}
