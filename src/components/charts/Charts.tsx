import { motion, useReducedMotion } from 'motion/react'
import { useId, useMemo, useState } from 'react'
import { cn } from '@/lib/utils'

/* Elegant, dependency-free SVG charts tuned for small screens. */

export interface Point {
  x: number // 0..1
  y: number
  label?: string
}

function smoothPath(points: Array<{ x: number; y: number }>): string {
  if (points.length < 2) return ''
  let d = `M ${points[0].x} ${points[0].y}`
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] ?? points[i]
    const p1 = points[i]
    const p2 = points[i + 1]
    const p3 = points[i + 2] ?? p2
    const t = 0.22
    const c1x = p1.x + (p2.x - p0.x) * t
    const c1y = p1.y + (p2.y - p0.y) * t
    const c2x = p2.x - (p3.x - p1.x) * t
    const c2y = p2.y - (p3.y - p1.y) * t
    d += ` C ${c1x} ${c1y}, ${c2x} ${c2y}, ${p2.x} ${p2.y}`
  }
  return d
}

export function LineChart({
  data,
  height = 160,
  className,
  formatValue = (v) => v.toFixed(1),
  target,
  yMinPad = 0.5,
}: {
  data: Array<{ label: string; value: number }>
  height?: number
  className?: string
  formatValue?: (v: number) => string
  target?: number
  yMinPad?: number
}) {
  const id = useId()
  const reduce = useReducedMotion()
  const [hover, setHover] = useState<number | null>(null)
  const w = 320
  const padX = 8
  const padTop = 18
  const padBottom = 22
  const { path, area, pts, min, max } = useMemo(() => {
    if (!data.length) return { path: '', area: '', pts: [] as Array<{ x: number; y: number }>, min: 0, max: 1 }
    const values = data.map((d) => d.value)
    const dMin = Math.min(...values)
    const dMax = Math.max(...values)
    // Only stretch the axis to a goal that is reasonably close; a far goal is labelled instead.
    const near = target !== undefined && target >= dMin - 3 && target <= dMax + 3
    let min = Math.min(dMin, near ? target! : Infinity)
    let max = Math.max(dMax, near ? target! : -Infinity)
    if (max - min < yMinPad * 2) {
      const mid = (max + min) / 2
      min = mid - yMinPad
      max = mid + yMinPad
    }
    const span = max - min || 1
    const pts = data.map((d, i) => ({
      x: padX + (i / Math.max(1, data.length - 1)) * (w - padX * 2),
      y: padTop + (1 - (d.value - min) / span) * (height - padTop - padBottom),
    }))
    const path = smoothPath(pts)
    const area = `${path} L ${pts[pts.length - 1].x} ${height - padBottom} L ${pts[0].x} ${height - padBottom} Z`
    return { path, area, pts, min, max }
  }, [data, height, target, yMinPad])

  if (!data.length) return null
  const last = pts[pts.length - 1]
  const active = hover ?? data.length - 1
  const targetInRange = target !== undefined && target >= min && target <= max
  const targetY = targetInRange ? padTop + (1 - (target! - min) / (max - min || 1)) * (height - padTop - padBottom) : undefined

  return (
    <div className={cn('relative w-full', className)}>
      {target !== undefined && !targetInRange && (
        <div className="absolute right-0 top-0 text-[11px] text-text-3 pointer-events-none">
          Goal {formatValue(target)} {target > max ? '↑' : '↓'}
        </div>
      )}
      <svg
        viewBox={`0 0 ${w} ${height}`}
        className="w-full h-auto overflow-visible"
        onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => {
          const rect = e.currentTarget.getBoundingClientRect()
          const x = ((e.clientX - rect.left) / rect.width) * w
          let best = 0
          pts.forEach((p, i) => {
            if (Math.abs(p.x - x) < Math.abs(pts[best].x - x)) best = i
          })
          setHover(best)
        }}
        onTouchMove={(e) => {
          const rect = e.currentTarget.getBoundingClientRect()
          const x = ((e.touches[0].clientX - rect.left) / rect.width) * w
          let best = 0
          pts.forEach((p, i) => {
            if (Math.abs(p.x - x) < Math.abs(pts[best].x - x)) best = i
          })
          setHover(best)
        }}
        onTouchEnd={() => setHover(null)}
      >
        <defs>
          <linearGradient id={`${id}-fill`} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.28" />
            <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
          </linearGradient>
        </defs>
        {targetY !== undefined && (
          <>
            <line x1={padX} x2={w - padX} y1={targetY} y2={targetY} stroke="var(--text-4)" strokeDasharray="3 4" strokeWidth={1} />
            <text x={w - padX} y={targetY - 5} textAnchor="end" fontSize={10} fill="var(--text-3)">
              Goal {formatValue(target!)}
            </text>
          </>
        )}
        <motion.path d={area} fill={`url(#${id}-fill)`} initial={{ opacity: reduce ? 1 : 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.5, duration: 0.6 }} />
        <motion.path d={path} fill="none" stroke="var(--accent)" strokeWidth={2.2} strokeLinecap="round" initial={{ pathLength: reduce ? 1 : 0 }} animate={{ pathLength: 1 }} transition={{ duration: 1.1, ease: [0.22, 1, 0.36, 1] }} />
        {hover !== null && <line x1={pts[hover].x} x2={pts[hover].x} y1={padTop - 6} y2={height - padBottom} stroke="var(--border-strong)" strokeWidth={1} />}
        <circle cx={pts[active].x} cy={pts[active].y} r={4.5} fill="var(--accent)" stroke="var(--bg)" strokeWidth={2} />
        {hover === null && <circle cx={last.x} cy={last.y} r={9} fill="var(--accent)" opacity={0.18} />}
        <text x={padX} y={height - 6} fontSize={10} fill="var(--text-3)">
          {data[0].label}
        </text>
        <text x={w - padX} y={height - 6} fontSize={10} fill="var(--text-3)" textAnchor="end">
          {data[data.length - 1].label}
        </text>
      </svg>
      <div className="absolute left-0 top-0 text-[12px] text-text-2 tabular pointer-events-none">
        <span className="font-semibold text-text text-[14px]">{formatValue(data[active].value)}</span>
        <span className="ml-1.5 text-text-3">{data[active].label}</span>
      </div>
    </div>
  )
}

export function BarChart({ data, height = 120, className, highlightLast = true, formatValue = (v) => String(Math.round(v)), target }: { data: Array<{ label: string; value: number }>; height?: number; className?: string; highlightLast?: boolean; formatValue?: (v: number) => string; target?: number }) {
  const reduce = useReducedMotion()
  const [active, setActive] = useState<number | null>(null)
  const max = Math.max(...data.map((d) => d.value), target ?? 0, 1)
  const idx = active ?? data.length - 1
  return (
    <div className={cn('w-full', className)}>
      <div className="text-[12px] text-text-2 tabular mb-2 h-4">
        <span className="font-semibold text-text text-[14px]">{formatValue(data[idx]?.value ?? 0)}</span>
        <span className="ml-1.5 text-text-3">{data[idx]?.label}</span>
      </div>
      <div className="relative flex items-end gap-1.5" style={{ height }}>
        {target !== undefined && <div className="absolute left-0 right-0 border-t border-dashed border-text-4" style={{ bottom: `${(target / max) * 100}%` }} />}
        {data.map((d, i) => {
          const h = Math.max(3, (d.value / max) * 100)
          const isLast = highlightLast && i === data.length - 1
          const isActive = active === i
          return (
            <button
              key={i}
              onMouseEnter={() => setActive(i)}
              onMouseLeave={() => setActive(null)}
              onClick={() => setActive(active === i ? null : i)}
              className="flex-1 h-full flex flex-col items-center justify-end group"
              aria-label={`${d.label}: ${formatValue(d.value)}`}
            >
              <motion.div
                className={cn('w-full rounded-[6px]', isLast || isActive ? 'bg-accent' : 'bg-surface-3 group-hover:bg-text-4')}
                initial={{ height: reduce ? `${h}%` : 0 }}
                animate={{ height: `${h}%` }}
                transition={{ duration: 0.6, delay: i * 0.04, ease: [0.22, 1, 0.36, 1] }}
              />
            </button>
          )
        })}
      </div>
      <div className="flex gap-1.5 mt-1.5">
        {data.map((d, i) => (
          <div key={i} className="flex-1 text-center text-[10px] text-text-3 truncate">
            {d.label}
          </div>
        ))}
      </div>
    </div>
  )
}

export function Sparkline({ values, className, width = 80, height = 26 }: { values: number[]; className?: string; width?: number; height?: number }) {
  if (values.length < 2) return null
  const min = Math.min(...values)
  const max = Math.max(...values)
  const span = max - min || 1
  const pts = values.map((v, i) => ({ x: (i / (values.length - 1)) * (width - 4) + 2, y: 2 + (1 - (v - min) / span) * (height - 4) }))
  return (
    <svg width={width} height={height} className={className} aria-hidden>
      <path d={smoothPath(pts)} fill="none" stroke="var(--accent)" strokeWidth={1.8} strokeLinecap="round" />
    </svg>
  )
}
