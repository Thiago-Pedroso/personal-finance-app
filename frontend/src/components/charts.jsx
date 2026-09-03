import {
  ResponsiveContainer, ComposedChart, Bar, Line, XAxis, YAxis,
  CartesianGrid, Tooltip, Cell, PieChart, Pie, BarChart, AreaChart, Area,
} from 'recharts'
import { Receipt } from 'lucide-react'
import { brl, brl0, monthShortY } from '../lib/format.js'
import { catColor, catMeta } from '../lib/categories.jsx'
import { usePrivacy } from '../lib/usePrivacy.jsx'
import { SensitiveAmount } from './ui/SensitiveValue.jsx'

export const PALETTE = [
  '#36c98b', '#5aa2ff', '#b08cff', '#e0a93b', '#f4685f',
  '#4dd0c4', '#ef79b6', '#9bd1ff', '#ffb35c', '#7ee7a8',
  '#79b8ff', '#ffe066', '#c98bff', '#7adf6f',
]

// sparkline inline (SVG puro) — tendência enxuta dentro de um KPI
export function Sparkline({ data, color = '#79838f', width = 76, height = 26 }) {
  const vals = (data || []).filter((v) => v != null && !Number.isNaN(v))
  if (vals.length < 2) return null
  const min = Math.min(...vals), max = Math.max(...vals)
  const rng = max - min || 1
  const pad = 2
  const pts = data.map((v, i) => [
    (i / (data.length - 1)) * (width - pad * 2) + pad,
    height - pad - ((v - min) / rng) * (height - pad * 2),
  ])
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' ')
  const last = pts[pts.length - 1]
  return (
    <svg width={width} height={height} className="overflow-visible" aria-hidden="true">
      <path d={d} fill="none" stroke={color} strokeWidth="1.5"
        strokeLinejoin="round" strokeLinecap="round" opacity="0.85" />
      <circle cx={last[0]} cy={last[1]} r="2.2" fill={color} />
    </svg>
  )
}

function TipBox({ rows, label }) {
  return (
    <div className="rounded-xl border border-border bg-surface2/95 px-3.5 py-2.5
      text-[12.5px] shadow-xl backdrop-blur">
      <div className="mb-1 font-semibold">{label}</div>
      {rows.map((r) => (
        <div key={r.k} className="flex items-center justify-between gap-6">
          <span className="flex items-center gap-1.5 text-muted">
            <i className="inline-block size-2 rounded-full"
              style={{ background: r.c }} />{r.k}
          </span>
          <span className="tnum" style={{ color: r.c }}>
            <SensitiveAmount>{brl(r.v)}</SensitiveAmount>
          </span>
        </div>
      ))}
    </div>
  )
}

export function CashflowChart({ months, selected, onSelect, showSaved }) {
  const { valuesHidden } = usePrivacy()
  const data = months.map((m) => ({ ...m, lbl: monthShortY(m.month) }))
  return (
    <ResponsiveContainer width="100%" height={300}>
      <ComposedChart data={data} margin={{ top: 8, right: 8, left: 4, bottom: 0 }}
        onClick={(e) => e?.activeLabel &&
          onSelect(data.find((d) => d.lbl === e.activeLabel)?.month)}>
        <CartesianGrid stroke="#2c313a" strokeDasharray="3 5" vertical={false} />
        <XAxis dataKey="lbl" tick={{ fill: '#8a97a6', fontSize: 11 }}
          axisLine={{ stroke: '#2c313a' }} tickLine={false} />
        <YAxis tickFormatter={valuesHidden ? () => '' : brl0} width={64}
          tick={{ fill: '#5d6b7a', fontSize: 11 }} axisLine={false}
          tickLine={false} />
        <Tooltip cursor={{ fill: '#ffffff08' }}
          content={({ active, payload, label }) => active && payload?.length ? (
            <TipBox label={label} rows={[
              { k: 'Receitas', v: payload[0]?.payload.income, c: '#36c98b' },
              { k: 'Gastos', v: payload[0]?.payload.expense, c: '#f4685f' },
              { k: 'Saldo', v: payload[0]?.payload.net, c: '#5aa2ff' },
              ...(showSaved
                ? [{ k: 'Poupado', v: payload[0]?.payload.saved, c: '#b08cff' }]
                : []),
            ]} />
          ) : null} />
        <Bar dataKey="income" radius={[4, 4, 0, 0]} maxBarSize={16}
          className="cursor-pointer">
          {data.map((d) => <Cell key={d.month}
            fill={d.month === selected ? '#36c98b' : '#36c98b66'} />)}
        </Bar>
        <Bar dataKey="expense" radius={[4, 4, 0, 0]} maxBarSize={16}
          className="cursor-pointer">
          {data.map((d) => <Cell key={d.month}
            fill={d.month === selected ? '#f4685f' : '#f4685f66'} />)}
        </Bar>
        <Line type="monotone" dataKey="net" stroke="#5aa2ff" strokeWidth={2}
          dot={{ r: 2.5, fill: '#5aa2ff' }} activeDot={{ r: 4 }} />
        {showSaved && (
          <Line type="monotone" dataKey="saved" stroke="#b08cff" strokeWidth={2}
            strokeDasharray="5 3" dot={{ r: 2, fill: '#b08cff' }}
            activeDot={{ r: 4 }} />
        )}
      </ComposedChart>
    </ResponsiveContainer>
  )
}

// Além de ~8 fatias ninguém casa cor com legenda, então o excedente vira uma
// fatia "Outras". Clicar nela não filtra (não é categoria de verdade).
const MAX_SLICES = 7
const REST_LABEL = 'Outras categorias'

export function CategoryDonut({ slices, onSelect, onOpen, palette }) {
  const { valuesHidden } = usePrivacy()
  const colorOf = (label, i) =>
    label === REST_LABEL ? '#8a97a6'
      : palette ? PALETTE[i % PALETTE.length] : catColor(label)
  const visible = slices.filter((s) => s.value > 0)
    .sort((a, b) => b.value - a.value)
  const rest = visible.slice(MAX_SLICES)
  const data = rest.length > 1
    ? [...visible.slice(0, MAX_SLICES),
       { label: REST_LABEL, value: rest.reduce((a, s) => a + s.value, 0),
         rest: rest.length }]
    : visible
  const total = data.reduce((a, s) => a + s.value, 0)
  if (!total) return <p className="py-10 text-center text-[13px] text-faint">
    Sem gastos neste mês.</p>
  return (
    <div className="flex flex-wrap items-center gap-5">
      <ResponsiveContainer width={200} height={200}>
        <PieChart>
          <Pie data={data} dataKey="value" nameKey="label" innerRadius={58}
            outerRadius={90} paddingAngle={1.5} stroke="none"
            onClick={(d) => d.label !== REST_LABEL && onSelect?.(d.label)}>
            {data.map((d, i) => <Cell key={d.label} className="cursor-pointer"
              fill={colorOf(d.label, i)} />)}
          </Pie>
          <Tooltip content={({ active, payload }) => active && payload?.length ? (
            <div className="rounded-xl border border-border bg-surface2/95
              px-3 py-2 text-[12.5px] shadow-xl">
              <b>{payload[0].name}</b> ·{' '}
              {valuesHidden ? (
                `${((payload[0].value / total) * 100).toFixed(0)}%`
              ) : (
                <>{brl(payload[0].value)} ·{' '}
                  {((payload[0].value / total) * 100).toFixed(0)}%</>
              )}
            </div>) : null} />
        </PieChart>
      </ResponsiveContainer>
      <div className="flex min-w-[210px] flex-1 flex-col gap-1.5">
        {data.map((s, i) => {
          const isRest = s.label === REST_LABEL
          const M = palette || isRest ? null : catMeta(s.label)
          return (
          <div key={s.label}
            className="group flex items-center gap-2 rounded-lg px-2 py-1
              text-[13px] hover:bg-white/5">
            <button onClick={() => !isRest && onSelect?.(s.label)}
              className="flex flex-1 items-center justify-between gap-3
                text-left">
              <span className="flex items-center gap-2">
                {M ? <M.Icon className="size-3.5" style={{ color: M.color }} />
                  : <i className="size-2.5 rounded-[3px]"
                      style={{ background: colorOf(s.label, i) }} />}
                {isRest ? `${s.label} (${s.rest})` : s.label}
              </span>
              <span className="tnum text-muted">
                {valuesHidden ? (
                  `${((s.value / total) * 100).toFixed(0)}%`
                ) : (
                  <>{brl(s.value)} · {((s.value / total) * 100).toFixed(0)}%</>
                )}
              </span>
            </button>
            {onOpen && (
              <button onClick={(e) => { e.stopPropagation(); onOpen(s.label) }}
                title={`Ver lançamentos · ${s.label}`}
                className="shrink-0 rounded-md p-1 text-faint opacity-0
                  transition hover:bg-surface2 hover:text-text
                  group-hover:opacity-100 focus:opacity-100">
                <Receipt className="size-3.5" />
              </button>
            )}
          </div>
          )
        })}
      </div>
    </div>
  )
}

export function HBars({ items, color = '#f4685f', onClick, onOpen, byCat,
  totalValue }) {
  const { valuesHidden } = usePrivacy()
  if (!items.length) return <p className="py-8 text-center text-[13px]
    text-faint">Nada aqui.</p>
  const max = Math.max(...items.map((i) => i.value), 1)
  const total = totalValue ?? items.reduce((sum, item) => sum + item.value, 0)
  return (
    <div className="flex flex-col gap-2.5">
      {items.map((it) => {
        const M = byCat ? catMeta(it.label) : null
        const bar = byCat ? M.color : color
        return (
        <div key={it.key ?? it.label} className="group">
          <div className="mb-1 flex items-center justify-between gap-2
            text-[13px]">
            <button onClick={() => onClick?.(it.label)}
              className={`flex flex-1 items-center gap-1.5 font-medium
                text-left ${onClick ? 'cursor-pointer hover:text-green'
                  : 'cursor-default'}`}>
              {M && <M.Icon className="size-3.5" style={{ color: M.color }} />}
              {it.label}
              {it.count != null && <span className="ml-1 text-[11px]
                text-faint">{it.count}x</span>}
            </button>
            <span className="tnum text-muted">
              {valuesHidden
                ? `${total ? Math.round((it.value / total) * 100) : 0}%`
                : brl(it.value)}
            </span>
            {onOpen && (
              <button onClick={() => onOpen(it.label)}
                title={`Ver lançamentos · ${it.label}`}
                className="shrink-0 rounded-md p-1 text-faint opacity-0
                  transition hover:bg-surface2 hover:text-text
                  group-hover:opacity-100 focus:opacity-100">
                <Receipt className="size-3.5" />
              </button>
            )}
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-white/[0.06]">
            <div className="h-full rounded-full"
              style={{ width: `${Math.max(2, (it.value / max) * 100)}%`,
                background: bar }} />
          </div>
        </div>
        )
      })}
    </div>
  )
}

// evolução de patrimônio: área empilhada aportado (azul) + juros (verde), amostra anual
export function WealthChart({ series }) {
  const { valuesHidden } = usePrivacy()
  const data = series.filter((s) => s.m % 12 === 0).map((s) => ({
    yr: s.m / 12, aportado: s.contributed, juros: s.interest,
  }))
  return (
    <ResponsiveContainer width="100%" height={230}>
      <AreaChart data={data} margin={{ top: 8, right: 8, left: 4, bottom: 0 }}>
        <defs>
          <linearGradient id="wAport" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#5b9dff" stopOpacity={0.45} />
            <stop offset="100%" stopColor="#5b9dff" stopOpacity={0.04} />
          </linearGradient>
          <linearGradient id="wJuros" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#41cf8f" stopOpacity={0.5} />
            <stop offset="100%" stopColor="#41cf8f" stopOpacity={0.04} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke="#2c313a" strokeDasharray="3 5" vertical={false} />
        <XAxis dataKey="yr" tickFormatter={(y) => `${y}a`}
          tick={{ fill: '#7e8a97', fontSize: 11 }}
          axisLine={{ stroke: '#2c313a' }} tickLine={false} />
        <YAxis tickFormatter={valuesHidden ? () => '' : brl0} width={64}
          tick={{ fill: '#7e8a97', fontSize: 11 }} axisLine={false} tickLine={false} />
        <Tooltip cursor={{ stroke: '#3a4450' }}
          content={({ active, payload, label }) => active && payload?.length ? (
            <TipBox label={`Ano ${label}`} rows={[
              { k: 'Aportado', v: payload.find((p) => p.dataKey === 'aportado')?.value, c: '#5b9dff' },
              { k: 'Juros', v: payload.find((p) => p.dataKey === 'juros')?.value, c: '#41cf8f' },
            ]} />
          ) : null} />
        <Area type="monotone" dataKey="aportado" stackId="1" stroke="#5b9dff"
          strokeWidth={1.5} fill="url(#wAport)" isAnimationActive={false} />
        <Area type="monotone" dataKey="juros" stackId="1" stroke="#41cf8f"
          strokeWidth={1.5} fill="url(#wJuros)" isAnimationActive={false} />
      </AreaChart>
    </ResponsiveContainer>
  )
}

export function TrendBars({ data, color = '#f4685f' }) {
  const { valuesHidden } = usePrivacy()
  return (
    <ResponsiveContainer width="100%" height={210}>
      <BarChart data={data} margin={{ top: 6, right: 6, left: 4, bottom: 0 }}>
        <CartesianGrid stroke="#2c313a" strokeDasharray="3 5" vertical={false} />
        <XAxis dataKey="lbl" tick={{ fill: '#8a97a6', fontSize: 10 }}
          axisLine={{ stroke: '#28323f' }} tickLine={false} interval={0} />
        <YAxis tickFormatter={valuesHidden ? () => '' : brl0} width={58}
          tick={{ fill: '#5d6b7a', fontSize: 10 }} axisLine={false}
          tickLine={false} />
        <Tooltip cursor={{ fill: '#ffffff08' }}
          content={({ active, payload, label }) => active && payload?.length ? (
            <div className="rounded-xl border border-border bg-surface2/95
              px-3 py-2 text-[12.5px] shadow-xl">
              <b>{label}</b> ·{' '}
              <SensitiveAmount>{brl(payload[0].value)}</SensitiveAmount>
            </div>) : null} />
        <Bar dataKey="value" radius={[4, 4, 0, 0]} maxBarSize={26} fill={color} />
      </BarChart>
    </ResponsiveContainer>
  )
}
