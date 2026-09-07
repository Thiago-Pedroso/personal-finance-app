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
      {pctValue != null && <span className="ml-2 text-[12px] opacity-80">
        {signedPct(pctValue)}</span>}
    </span>
  )
}

// Duas barras empilhadas: onde a carteira está e onde deveria estar. O desvio vira
// distância que se vê, em vez de número para interpretar.
export function DriftBar({ real, target, height = 'h-2' }) {
  const scale = Math.max(real, target, 0.0001)
  return (
    <div className="flex flex-col gap-[3px]">
      <div className={`${height} overflow-hidden rounded-full bg-surface2`}>
        <div className="h-full rounded-full bg-brand"
          style={{ width: `${Math.min((real / scale) * 100, 100)}%` }} />
      </div>
      <div className={`${height} overflow-hidden rounded-full bg-surface2`}>
        <div className="h-full rounded-full bg-faint/40"
          style={{ width: `${Math.min((target / scale) * 100, 100)}%` }} />
      </div>
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
    <span className={`tnum rounded-full px-2 py-0.5 text-[11px] font-semibold ${tone}`}
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
