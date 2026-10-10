import { useState } from 'react'
import { Card, CardHead, Button, Badge } from './ui/primitives.jsx'
import { CashflowChart, CategoryDonut, Sparkline } from './charts.jsx'
import { catMeta, subcategoryMeta } from '../lib/categories.jsx'
import { useDrill } from '../lib/useDrill.jsx'
import {
  brl, signedBrl, fmtPct, pctDelta, monthLabel, fullDate,
} from '../lib/format.js'
import { SensitiveAmount } from './ui/SensitiveValue.jsx'
import {
  TrendingUp, TrendingDown, ArrowRight, ChevronLeft, ChevronRight, ListFilter,
} from 'lucide-react'

const CHART_MONTHS = 13

function Kpi({ label, value, prev, kind, onClick, spark }) {
  const d = prev == null ? null : value - prev
  const p = pctDelta(value, prev)
  const up = d > 0
  const goodUp = kind !== 'expense'
  const good = d == null || d === 0 ? null : up === goodUp
  // % só quando é informativa: base grande, sem virada de sinal e sem explodir
  const showPct = p != null && Math.abs(p) < 1000 && Math.abs(prev) >= 1
    && Math.sign(value) === Math.sign(prev)
  const valColor = kind === 'income' ? 'text-green'
    : kind === 'expense' ? 'text-red'
      : value > 0 ? 'text-green' : value < 0 ? 'text-red' : 'text-text'
  const sparkColor = kind === 'income' ? '#3ec98b'
    : kind === 'expense' ? '#f4685f' : '#79838f'
  return (
    <Card className={`relative p-5 ${onClick ? 'cursor-pointer hover:border-faint' : ''}`}
      onClick={onClick}>
      {spark && (
        <div className="absolute right-4 top-4">
          <Sparkline data={spark} color={sparkColor} />
        </div>
      )}
      <div className="text-[15px] font-bold text-strong">{label}</div>
      <div className={`mt-1.5 text-[28px] font-bold tnum ${valColor}`}>
        <SensitiveAmount>{brl(value)}</SensitiveAmount></div>
      <div className="mt-2 flex items-center gap-1.5 text-[12.5px]">
        {d == null ? <span className="text-faint">sem mês anterior</span> : (
          <>
            <span className={good ? 'text-green' : good === false
              ? 'text-red' : 'text-faint'}>
              {up ? <TrendingUp className="inline size-3.5" />
                : <TrendingDown className="inline size-3.5" />}{' '}
              <SensitiveAmount>{signedBrl(d)}</SensitiveAmount>
              {showPct ? ` (${fmtPct(p)})` : ''}
            </span>
            <span className="text-faint">vs. mês anterior</span>
          </>
        )}
      </div>
    </Card>
  )
}

// Saldo total no fim do período: âncora (ou zero) somada aos saldos mensais seguintes
function TotalBalanceKpi({ months, period, anchor }) {
  const upToPeriod = months.filter((m) => m.month.slice(0, period.length) <= period)
  const series = upToPeriod.map((m) => m.balance_total).filter((v) => v != null)
  const value = upToPeriod.at(-1)?.balance_total ?? null
  const since = anchor
    ? `desde ${fullDate(anchor.date)}`
    : `acumulado desde ${monthLabel(months[0]?.month)}`
  return (
    <Card className="relative p-5"
      title={anchor ? undefined
        : 'Sem âncora: soma dos saldos mensais desde o primeiro mês do histórico'}>
      <div className="absolute right-4 top-4">
        <Sparkline data={series.slice(-8)} color="#79838f" />
      </div>
      <div className="text-[15px] font-bold text-strong">
        {anchor ? 'Saldo total' : 'Saldo acumulado'}</div>
      <div className={`mt-1.5 text-[28px] font-bold tnum ${value == null
        ? 'text-faint' : value >= 0 ? 'text-green' : 'text-red'}`}>
        {value == null ? '—'
          : <SensitiveAmount>{brl(value)}</SensitiveAmount>}</div>
      <div className="mt-2 text-[13px] text-subtle">
        {value == null ? 'período anterior à âncora' : since}</div>
    </Card>
  )
}

export function Overview({ dash, month, mdata, setMonth, goCategory,
  goReview, queue }) {
  const drill = useDrill()
  // filtro de categoria da Visão Geral (filtra KPIs, gráfico, donut…)
  const [focus, setFocus] = useState(null)
  const isMonth = /^\d{4}-\d{2}$/.test(month)
  const i = dash.months.findIndex((m) => m.month === month)
  const prevM = isMonth && i > 0 ? dash.months[i - 1] : null

  const cats = Object.entries(mdata.by_category || {})
    .map(([label, c]) => ({ label, value: c.expense, count: c.count }))
    .filter((c) => c.value > 0).sort((a, b) => b.value - a.value)
  const movs = Object.entries(mdata.movements || {})
    .map(([label, m]) => ({ label, net: m.in - m.out }))
    .sort((a, b) => Math.abs(b.net) - Math.abs(a.net))
  const pend = dash.pending ?? (dash.needs_review + dash.uncategorized)

  // quando há foco numa categoria, tudo reflete só ela
  const fc = focus ? (mdata.by_category?.[focus] || { income: 0, expense: 0 }) : null
  const fp = focus && prevM ? (prevM.by_category?.[focus] || {}) : null
  const cur = focus
    ? { income: fc.income || 0, expense: fc.expense || 0,
        net: (fc.income || 0) - (fc.expense || 0) }
    : mdata
  const prev = focus
    ? (fp ? { income: fp.income || 0, expense: fp.expense || 0,
             net: (fp.income || 0) - (fp.expense || 0) } : null)
    : prevM
  const chartMonths = (focus
    ? dash.months.map((m) => {
        const c = m.by_category?.[focus] || {}
        return { month: m.month, income: c.income || 0,
          expense: c.expense || 0, net: (c.income || 0) - (c.expense || 0) }
      })
    : dash.months).slice(-CHART_MONTHS)
  const subItems = focus
    ? Object.entries(mdata.by_category?.[focus]?.subcategories || {})
        .map(([label, s]) => ({ label, value: s.expense, count: s.count,
          color: subcategoryMeta(focus, label).color }))
        .filter((s) => s.value > 0).sort((a, b) => b.value - a.value)
    : null
  const tag = focus ? ` · ${focus}` : ''
  // séries curtas p/ as sparklines dos KPIs (últimos 8 meses, respeita o foco)
  const sparkOf = (key) => chartMonths.slice(-8).map((m) => m[key] || 0)
  // card do saldo do período: sempre sobre o período inteiro (independe do foco)
  const plan = mdata.plan || {}
  const daily = plan.daily_allowed || 0
  const daysLeft = plan.days_left
  const planned = plan.total_planned || 0
  const realizedPlan = plan.total_realized || 0
  const hasPlan = planned > 0
  const mIncome = mdata.income || 0
  const mExpense = mdata.expense || 0
  const mSaved = mdata.saved || 0                       // Poupado (aportes − resgates)
  const mNet = mIncome - mExpense - mSaved
  const savedSpark = dash.months.slice(-8).map((m) => m.saved || 0)
  const taxaPoup = mIncome >= 1 ? Math.round((mSaved / mIncome) * 100) : null
  const spentPct = hasPlan ? Math.min((realizedPlan / planned) * 100, 100) : 0
  const openCat = (c, sub) => drill?.drill(
    `${c}${sub ? ' / ' + sub : ''} — ${monthLabel(month)}`,
    sub ? { cats: [c], sub, flow: 'out' } : { cats: [c], flow: 'out' })

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[12.5px] text-muted">Filtrar por categoria:</span>
        <select value={focus || ''}
          onChange={(e) => setFocus(e.target.value || null)}
          className="rounded-xl border border-border bg-surface2 px-3 py-1.5
            text-[13px] hover:border-faint">
          <option value="">Todas as categorias</option>
          {[...new Set([...cats.map((c) => c.label),
            ...Object.keys(dash.taxonomy || {})])].sort()
            .map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        {focus && (
          <button onClick={() => setFocus(null)}
            className="flex items-center gap-1.5 rounded-xl border
              border-brand/40 bg-brand/10 px-3 py-1.5 text-[12.5px] text-brand">
            {(() => { const M = catMeta(focus); return (
              <M.Icon className="size-3.5" />) })()}
            {focus} <span className="text-faint">✕</span>
          </button>
        )}
      </div>

      <Card className="relative flex flex-col gap-5 overflow-hidden border-brand/20
        bg-gradient-to-br from-brand/[0.06] via-transparent to-transparent p-5
        sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-[220px]">
          <div className="text-[17px] font-bold text-strong">
            Saldo de {monthLabel(month)}</div>
          <div className={`mt-1 text-[30px] font-bold tnum ${
            mNet >= 0 ? 'text-green' : 'text-red'}`}>
            <SensitiveAmount>{signedBrl(mNet)}</SensitiveAmount></div>
          {hasPlan && daily > 0 && (
            <div className="mt-0.5 text-[12.5px] text-muted">
              <SensitiveAmount>{brl(daily)}</SensitiveAmount> por dia
              {daysLeft != null ? ` nos ${daysLeft} dia(s) restantes` : ''}
            </div>
          )}
        </div>
        <div className="flex-1 sm:max-w-[440px]">
          {hasPlan ? (
            <>
              <div className="flex items-center justify-between text-[12.5px]">
                <span className="text-muted">Gasto vs. planejado</span>
                <span className="tnum text-muted">
                  <SensitiveAmount>{brl(realizedPlan)}</SensitiveAmount>{' '}
                  <span className="text-faint">/{' '}
                    <SensitiveAmount>{brl(planned)}</SensitiveAmount>
                  </span>
                </span>
              </div>
              <div className="mt-2 h-2.5 overflow-hidden rounded-full
                bg-white/[0.06]">
                <div className="h-full rounded-full transition-[width]
                  duration-500" style={{ width: `${spentPct}%`,
                    background: realizedPlan > planned ? '#f56a60' : '#5b9dff' }} />
              </div>
              <div className="mt-1 text-right text-[11px] text-faint">
                {Math.round((realizedPlan / planned) * 100)}% do planejado</div>
            </>
          ) : (
            <>
              <div className="flex items-center justify-between text-[12.5px]">
                <span className="text-green">entrou{' '}
                  <SensitiveAmount>{brl(mIncome)}</SensitiveAmount></span>
                <span className="text-red">saiu{' '}
                  <SensitiveAmount>{brl(mExpense)}</SensitiveAmount></span>
              </div>
              <div className="mt-2 h-2.5 overflow-hidden rounded-full
                bg-white/[0.06]">
                <div className="h-full rounded-full bg-red transition-[width]
                  duration-500" style={{ width: `${mIncome > 0
                    ? Math.min((mExpense / mIncome) * 100, 100)
                    : (mExpense > 0 ? 100 : 0)}%` }} />
              </div>
              <div className="mt-1 text-right text-[11px] text-faint">
                {mIncome >= 1
                  ? `${Math.min(Math.round((mExpense / mIncome) * 100), 999)}% da renda gasta`
                  : 'sem renda registrada no período'}</div>
            </>
          )}
        </div>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi label={`Receitas${tag}`} value={cur.income} prev={prev?.income}
          kind="income" spark={sparkOf('income')} onClick={() => drill?.drill(
            `Receitas${tag} — ${monthLabel(month)}`,
            focus ? { cats: [focus], flow: 'in' } : { flow: 'in' })} />
        <Kpi label={`Gastos${tag}`} value={cur.expense} prev={prev?.expense}
          kind="expense" spark={sparkOf('expense')} onClick={() => drill?.drill(
            `Gastos${tag} — ${monthLabel(month)}`,
            focus ? { cats: [focus], flow: 'out' } : { flow: 'out' })} />
        {focus ? (
          <Kpi label={`Saldo${tag}`} value={cur.net} prev={prev?.net} kind="net"
            spark={sparkOf('net')}
            onClick={() => drill?.drill(`${focus} — ${monthLabel(month)}`,
              { cats: [focus] })} />
        ) : (
          <TotalBalanceKpi months={dash.months} period={month}
            anchor={dash.balance_anchor} />
        )}
        {/* Poupado — nível mês, cor própria (nem receita, nem gasto); clica → lançamentos */}
        <Card className="relative cursor-pointer p-5 hover:border-faint"
          onClick={() => drill?.drill(`Poupança — ${monthLabel(month)}`,
            { cats: dash.poupanca_cats || [] })}>
          <div className="absolute right-4 top-4">
            <Sparkline data={savedSpark} color="#b08cff" />
          </div>
          <div className="text-[15px] font-bold text-strong">Poupado</div>
          <div className="mt-1.5 text-[28px] font-bold tnum text-violet">
            <SensitiveAmount>{brl(mSaved)}</SensitiveAmount></div>
          <div className="mt-2 flex flex-wrap items-center gap-x-1.5 text-[12.5px]">
            <span className="text-violet">
              {taxaPoup != null ? `${taxaPoup}% da renda` : 'poupado no mês'}</span>
          </div>
        </Card>
      </div>

      {(pend > 0 || queue.length > 0) && (
        <Card className="flex flex-wrap items-center justify-between gap-3
          border-amber/30 bg-amber/[0.06] px-5 py-3 text-[13px]">
          <span>
            {pend > 0 && <><b>{pend}</b> pendência(s) pra revisar/categorizar </>}
            {queue.length > 0 && <>· <b>{queue.length}</b> na fila do Claude </>}
            no histórico de {dash.total_transactions} transações.
          </span>
          <Button onClick={goReview}>Abrir Revisar <ArrowRight className="size-4" /></Button>
        </Card>
      )}

      <Card>
        <CardHead
          title={focus ? `Fluxo mensal de ${focus}` : 'Fluxo mensal'}
          right={
            <div className="flex flex-wrap items-center justify-end gap-x-4 gap-y-2">
              {[['Receitas', '#36c98b'], ['Gastos', '#f4685f'], ['Saldo', '#5aa2ff'],
                ...(focus ? [] : [['Poupado', '#b08cff']])].map(([label, color]) => (
                <span key={label} className="flex items-center gap-1.5 text-[13px]
                  text-secondary">
                  <i className="size-2.5 rounded-full" style={{ background: color }} />
                  {label}
                </span>
              ))}
              <Badge>{chartMonths.length === 1 ? '1 mês'
                : `${chartMonths.length} meses`}</Badge>
            </div>
          } />
        <div className="px-3 pb-4">
          <CashflowChart months={chartMonths} selected={month}
            onSelect={(m) => m && setMonth(m)} showSaved={!focus} />
        </div>
      </Card>

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <Card>
          <CardHead
            title={focus ? (
              <span className="flex items-center gap-2">
                <button onClick={() => setFocus(null)}
                  className="flex items-center gap-1 rounded-lg px-1.5 py-0.5
                    text-secondary hover:bg-surface2 hover:text-strong">
                  <ChevronLeft className="size-4" /> Composição
                </button>
                <ChevronRight className="size-4 text-subtle" />
                <span className="flex items-center gap-1.5">
                  {(() => { const M = catMeta(focus); return (
                    <M.Icon className="size-4" style={{ color: M.color }} />) })()}
                  {focus}
                </span>
              </span>
            ) : 'Composição dos gastos'}
            right={
              <div className="flex items-center gap-1">
                {focus && (
                  <Button variant="ghost" onClick={() => openCat(focus)}>
                    <ListFilter className="size-4" /> Ver lançamentos
                  </Button>
                )}
                <Button variant="ghost"
                  onClick={() => goCategory(focus || cats[0]?.label)}>
                  Analisar <ArrowRight className="size-4" /></Button>
              </div>
            } />
          <div className="px-5 pb-5">
            <CategoryDonut
              palette={!!focus}
              slices={focus
                ? (subItems || []).map((s) => ({ label: s.label, value: s.value,
                    count: s.count, color: s.color }))
                : cats.map((c) => ({ label: c.label, value: c.value,
                    count: c.count }))}
              onSelect={(label) => focus
                ? openCat(focus, label) : setFocus(label)}
              onOpen={(label) => focus
                ? openCat(focus, label) : openCat(label)} />
          </div>
        </Card>
        <Card>
          <CardHead title="Fora do fluxo" />
          <div className="px-5 pb-5">
            {movs.length === 0 && <p className="py-6 text-center text-[14px]
              text-subtle">Nada neste período.</p>}
            {movs.map((m) => {
              const M = catMeta(m.label)
              return (
              <button key={m.label} onClick={() => drill?.drill(
                `${m.label} — ${monthLabel(month)}`, { cats: [m.label] })}
                className="flex w-full justify-between border-b border-border/60
                  py-2.5 text-[15px] last:border-0 hover:text-green">
                <span className="flex items-center gap-2 font-semibold text-strong">
                  <M.Icon className="size-4" style={{ color: M.color }} />
                  {m.label}</span>
                <span className={`tnum font-semibold ${
                  m.net >= 0 ? 'text-green' : 'text-red'}`}>
                  <SensitiveAmount>{signedBrl(m.net)}</SensitiveAmount></span>
              </button>
              )
            })}
          </div>
        </Card>
      </div>
    </div>
  )
}
