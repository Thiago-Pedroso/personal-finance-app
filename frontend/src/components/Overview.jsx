import { useState } from 'react'
import { Card, CardHead, Button } from './ui/primitives.jsx'
import { CashflowChart, CategoryDonut, HBars } from './charts.jsx'
import { catMeta } from '../lib/categories.jsx'
import { useDrill } from '../lib/useDrill.jsx'
import { brl, signedBrl, fmtPct, pctDelta, monthLabel } from '../lib/format.js'
import {
  TrendingUp, TrendingDown, ArrowRight, ChevronLeft, ListFilter,
} from 'lucide-react'

function Kpi({ label, value, prev, kind, onClick }) {
  const d = prev == null ? null : value - prev
  const p = pctDelta(value, prev)
  const up = d > 0
  const goodUp = kind !== 'expense'
  const good = d == null || d === 0 ? null : up === goodUp
  return (
    <Card className={`p-5 ${onClick ? 'cursor-pointer hover:border-faint' : ''}`}
      onClick={onClick}>
      <div className="text-[12px] font-semibold uppercase tracking-wider
        text-muted">{label}</div>
      <div className={`mt-1.5 text-[28px] font-bold tracking-tight ${
        kind === 'income' ? 'text-green' : kind === 'expense'
          ? 'text-red' : 'text-text'}`}>{brl(value)}</div>
      <div className="mt-2 flex items-center gap-1.5 text-[12.5px]">
        {d == null ? <span className="text-faint">sem mês anterior</span> : (
          <>
            <span className={good ? 'text-green' : good === false
              ? 'text-red' : 'text-faint'}>
              {up ? <TrendingUp className="inline size-3.5" />
                : <TrendingDown className="inline size-3.5" />}{' '}
              {brl(Math.abs(d))} ({fmtPct(p)})
            </span>
            <span className="text-faint">vs. mês anterior</span>
          </>
        )}
      </div>
    </Card>
  )
}

export function Overview({ dash, month, mdata, setMonth, goCategory,
  goReview, queue }) {
  const drill = useDrill()
  // filtro de categoria da Visão Geral (filtra KPIs, gráfico 13m, donut…)
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
  const chartMonths = focus
    ? dash.months.map((m) => {
        const c = m.by_category?.[focus] || {}
        return { month: m.month, income: c.income || 0,
          expense: c.expense || 0, net: (c.income || 0) - (c.expense || 0) }
      })
    : dash.months
  const subItems = focus
    ? Object.entries(mdata.by_category?.[focus]?.subcategories || {})
        .map(([label, s]) => ({ label, value: s.expense, count: s.count }))
        .filter((s) => s.value > 0).sort((a, b) => b.value - a.value)
    : null
  const tag = focus ? ` · ${focus}` : ''
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
              border-green/40 bg-green/10 px-3 py-1.5 text-[12.5px] text-green">
            {(() => { const M = catMeta(focus); return (
              <M.Icon className="size-3.5" />) })()}
            {focus} <span className="text-faint">✕</span>
          </button>
        )}
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Kpi label={`Receitas${tag}`} value={cur.income} prev={prev?.income}
          kind="income" onClick={() => drill?.drill(
            `Receitas${tag} — ${monthLabel(month)}`,
            focus ? { cats: [focus], flow: 'in' } : { flow: 'in' })} />
        <Kpi label={`Gastos${tag}`} value={cur.expense} prev={prev?.expense}
          kind="expense" onClick={() => drill?.drill(
            `Gastos${tag} — ${monthLabel(month)}`,
            focus ? { cats: [focus], flow: 'out' } : { flow: 'out' })} />
        <Kpi label={`Saldo${tag}`} value={cur.net} prev={prev?.net} kind="net"
          onClick={() => drill?.drill(`${focus || 'Tudo'} — ${monthLabel(month)}`,
            focus ? { cats: [focus] } : {})} />
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
          title={focus
            ? `${focus} — 13 meses`
            : 'Receitas × Gastos × Saldo — 13 meses'}
          sub={focus
            ? 'gráfico filtrado pela categoria · clique numa barra p/ o mês'
            : 'clique numa barra para trocar o mês'} />
        <div className="px-3 pb-4">
          <CashflowChart months={chartMonths} selected={month}
            onSelect={(m) => m && setMonth(m)} />
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <Card>
          <CardHead
            title={focus
              ? `Subcategorias de ${focus} — ${monthLabel(month)}`
              : `Maiores gastos — ${monthLabel(month)}`}
            sub={focus
              ? 'clique p/ filtrar · ícone p/ ver lançamentos'
              : 'clique p/ filtrar tudo · ícone p/ ver lançamentos'}
            right={<Button variant="ghost"
              onClick={() => goCategory(focus || cats[0]?.label)}>
              Analisar <ArrowRight className="size-4" /></Button>} />
          <div className="px-5 pb-5">
            {focus ? (
              <HBars items={subItems.slice(0, 12)}
                onClick={(s) => openCat(focus, s)}
                onOpen={(s) => openCat(focus, s)} />
            ) : (
              <HBars items={cats.slice(0, 9)} byCat
                onClick={(c) => setFocus(c)}
                onOpen={(c) => openCat(c)} />
            )}
          </div>
        </Card>
        <Card>
          <CardHead title={`Fora do fluxo — ${monthLabel(month)}`}
            sub="visível, não conta como receita/gasto" />
          <div className="px-5 pb-5">
            {movs.length === 0 && <p className="py-8 text-center text-[13px]
              text-faint">Nada neste mês.</p>}
            {movs.map((m) => {
              const M = catMeta(m.label)
              return (
              <button key={m.label} onClick={() => drill?.drill(
                `${m.label} — ${monthLabel(month)}`, { cats: [m.label] })}
                className="flex w-full justify-between border-b border-border/60
                  py-2 text-[13px] last:border-0 hover:text-green">
                <span className="flex items-center gap-2">
                  <M.Icon className="size-3.5" style={{ color: M.color }} />
                  {m.label}</span>
                <span className={`tnum ${m.net >= 0 ? 'text-green' : 'text-red'}`}>
                  {signedBrl(m.net)}</span>
              </button>
              )
            })}
          </div>
        </Card>
      </div>

      <Card>
        <CardHead
          title={focus ? (
            <span className="flex items-center gap-2">
              <button onClick={() => setFocus(null)}
                className="flex items-center gap-1 rounded-lg px-1.5 py-0.5
                  text-faint hover:bg-surface2 hover:text-text">
                <ChevronLeft className="size-4" /> Composição
              </button>
              <span className="text-faint">›</span>
              <span className="flex items-center gap-1.5">
                {(() => { const M = catMeta(focus); return (
                  <M.Icon className="size-4" style={{ color: M.color }} />) })()}
                {focus}
              </span>
            </span>
          ) : `Composição dos gastos — ${monthLabel(month)}`}
          sub={focus
            ? 'subcategorias · clique p/ filtrar · ícone p/ lançamentos'
            : 'clique numa categoria p/ filtrar · ícone p/ ver lançamentos'}
          right={focus && (
            <Button variant="ghost"
              onClick={() => openCat(focus)}>
              <ListFilter className="size-4" /> Ver lançamentos
            </Button>
          )} />
        <div className="px-5 pb-5">
          <CategoryDonut
            palette={!!focus}
            slices={focus
              ? (subItems || []).map((s) => ({ label: s.label, value: s.value }))
              : cats.map((c) => ({ label: c.label, value: c.value }))}
            onSelect={(label) => focus
              ? openCat(focus, label) : setFocus(label)}
            onOpen={(label) => focus
              ? openCat(focus, label) : openCat(label)} />
        </div>
      </Card>
    </div>
  )
}
