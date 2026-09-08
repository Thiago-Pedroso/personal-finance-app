import { Info } from 'lucide-react'

import { brl } from '../../lib/format.js'
import { SensitiveAmount } from '../ui/SensitiveValue.jsx'

export const pct = (value, places = 1) =>
  value == null ? '—' : `${(value * 100).toFixed(places)}%`
export const signedPct = (value, places = 2) =>
  value == null ? '—' : `${value > 0 ? '+' : value < 0 ? '−' : ''}${(Math.abs(value) * 100).toFixed(places)}%`

export function Money({ value, className = '' }) {
  return <SensitiveAmount className={className}>{brl(value)}</SensitiveAmount>
}

export function Profit({ value, pctValue }) {
  const tone = value > 0 ? 'text-green' : value < 0 ? 'text-red' : 'text-muted'
  return (
    <span className={`tnum ${tone}`}>
      <SensitiveAmount>{(value > 0 ? '+' : value < 0 ? '−' : '')
        + brl(Math.abs(value))}</SensitiveAmount>
      {pctValue != null && <span className="ml-2 text-[14px] opacity-85">
        {signedPct(pctValue)}</span>}
    </span>
  )
}

export function InvestmentPageHeader({ eyebrow, title, description, status, right }) {
  return (
    <header className="flex flex-col justify-between gap-4 pb-2 sm:flex-row
      sm:items-end">
      <div>
        {eyebrow && (
          <p className="mb-2 text-[12px] font-bold uppercase tracking-[0.1em]
            text-brand-soft">{eyebrow}</p>
        )}
        <h2 className="text-[28px] font-bold tracking-[-0.035em] text-strong
          sm:text-[34px]">{title}</h2>
        {description && (
          <p className="mt-2 max-w-2xl text-[15px] leading-6 text-secondary">
            {description}</p>
        )}
      </div>
      {(status || right) && (
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {status && (
            <span className="inline-flex w-fit items-center gap-2 rounded-full
              border border-border bg-surface/80 px-3 py-2 text-[13px]
              text-secondary">
              <span className="size-2 rounded-full bg-brand" />
              {status}
            </span>
          )}
          {right}
        </div>
      )}
    </header>
  )
}

export function InvestmentCardHeader({ title, description, right, info,
  className = '' }) {
  return (
    <div className={`flex flex-col justify-between gap-4 px-5 pb-4 pt-5
      sm:flex-row sm:items-start sm:px-6 sm:pt-6 ${className}`}>
      <div>
        <div className="flex items-center gap-2">
          <h3 className="text-[19px] font-bold tracking-[-0.02em] text-strong
            sm:text-[21px]">{title}</h3>
          {info && (
            <span tabIndex="0" title={info} aria-label={info}
              className="grid size-7 shrink-0 place-items-center rounded-full border
                border-border bg-surface2 text-subtle">
              <Info className="size-3.5" />
            </span>
          )}
        </div>
        {description && (
          <p className="mt-1.5 max-w-2xl text-[14px] leading-5 text-secondary">
            {description}</p>
        )}
      </div>
      {right && <div className="shrink-0">{right}</div>}
    </div>
  )
}

export function DriftBar({ real, target, height = 'h-3' }) {
  const realWidth = Math.min(Math.max(real * 100, 0), 100)
  const targetPosition = Math.min(Math.max(target * 100, 0), 100)
  return (
    <div className={`relative ${height} rounded-full bg-surface2`}>
      <div className="h-full rounded-full bg-brand"
        style={{ width: `${realWidth}%` }} />
      <span className="absolute -top-1 h-[calc(100%+8px)] w-0.5 rounded-full
        bg-strong shadow-[0_0_0_2px_#191e27]"
        style={{ left: `${targetPosition}%` }} />
    </div>
  )
}

export function DriftChip({ drift }) {
  if (drift == null) return null
  const strong = Math.abs(drift) > 0.02
  const tone = drift < 0
    ? (strong ? 'bg-brand/20 text-brand-soft' : 'bg-brand/10 text-brand-soft')
    : (strong ? 'bg-amber/15 text-amber' : 'bg-white/5 text-muted')
  return (
    <span className={`tnum rounded-full px-2.5 py-1 text-[12px] font-semibold ${tone}`}
      title={drift < 0 ? 'Abaixo do alvo: é para cá que o aporte vai'
        : 'Acima do alvo'}>
      {signedPct(drift)}
    </span>
  )
}

export function Problems({ items }) {
  if (!items?.length) return null
  return (
    <div className="rounded-2xl border border-amber/30 bg-amber/[0.07] px-5 py-4">
      <p className="text-[12px] font-semibold uppercase tracking-wider text-amber">
        Conferir</p>
      <ul className="mt-2 flex flex-col gap-1.5 text-[13px] text-muted">
        {items.map((item, index) => <li key={index}>{item}</li>)}
      </ul>
    </div>
  )
}
