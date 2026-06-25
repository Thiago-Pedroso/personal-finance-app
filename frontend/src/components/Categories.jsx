import { useMemo, useState } from 'react'
import { Card, CardHead, Button } from './ui/primitives.jsx'
import { inputCls } from './ui/MultiSelect.jsx'
import { TrendBars, HBars } from './charts.jsx'
import { useDrill } from '../lib/useDrill.jsx'
import { catMeta } from '../lib/categories.jsx'
import { brl, signedBrl, fmtPct, monthShortY, monthLabel } from '../lib/format.js'
import { ArrowRight } from 'lucide-react'

export function Categories({ dash, mdata, month, selectedCat, setSelectedCat,
  goTxns }) {
  const drill = useDrill()
  const i = dash.months.findIndex((m) => m.month === month)
  const cur = dash.months[i] || {}
  const prev = i > 0 ? dash.months[i - 1] : null

  const allCats = useMemo(() => {
    const s = new Set()
    dash.months.forEach((m) =>
      Object.keys(m.by_category || {}).forEach((c) => s.add(c)))
    return [...s].sort()
  }, [dash])

  const monthCats = Object.entries(mdata.by_category || {})
    .map(([label, c]) => ({ label, ...c })).sort((a, b) => b.expense - a.expense)
  const sel = selectedCat && allCats.includes(selectedCat)
    ? selectedCat : (monthCats[0]?.label || allCats[0] || '')

  const series = dash.months.map((m) => {
    const c = (m.by_category || {})[sel] || { income: 0, expense: 0 }
    return { month: m.month, income: c.income, expense: c.expense }
  })
  const incomeDom = series.reduce((a, s) => a + s.income, 0) >
    series.reduce((a, s) => a + s.expense, 0)
  const trend = series.map((s) => ({
    lbl: monthShortY(s.month), value: incomeDom ? s.income : s.expense,
  }))
  const selCur = (mdata.by_category || {})[sel]
  const subs = selCur ? Object.entries(selCur.subcategories || {})
    .map(([label, s]) => ({ label, value: incomeDom ? s.income : s.expense,
      count: s.count })).filter((s) => s.value > 0)
    .sort((a, b) => b.value - a.value) : []

  const cmp = allCats.map((c) => {
    const a = (cur.by_category || {})[c]?.expense || 0
    const b = (prev?.by_category || {})[c]?.expense || 0
    return { c, a, b, d: a - b,
      p: b ? ((a - b) / b) * 100 : null }
  }).filter((x) => x.a > 0 || x.b > 0).sort((x, y) => y.a - x.a)

  const totSel = incomeDom ? (selCur?.income || 0) : (selCur?.expense || 0)

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3
          px-5 pt-4">
          <div>
            <h3 className="text-[15px] font-semibold">Análise por categoria</h3>
            <p className="mt-0.5 text-[12px] text-faint">
              {sel} · {monthLabel(month)} · {brl(totSel)}{' '}
              ({incomeDom ? 'receita' : 'gasto'})
            </p>
          </div>
          <div className="flex items-center gap-2">
            <select value={sel} onChange={(e) => setSelectedCat(e.target.value)}
              className={inputCls()}>
              {allCats.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <Button onClick={() => goTxns(sel)}>
              Ver lançamentos <ArrowRight className="size-4" />
            </Button>
          </div>
        </div>
        <div className="grid gap-5 px-5 pb-5 pt-4 lg:grid-cols-2">
          <div>
            <p className="mb-2 text-[12px] text-muted">
              {incomeDom ? 'Receita' : 'Gasto'} mês a mês (13 meses)</p>
            <TrendBars data={trend} color={incomeDom ? '#36c98b' : '#f4685f'} />
          </div>
          <div>
            <p className="mb-2 text-[12px] text-muted">
              Subcategorias em {monthLabel(month)} — clique para ver lançamentos</p>
            <HBars items={subs} color={incomeDom ? '#36c98b' : '#f4685f'}
              onClick={(s) => drill?.drill(`${sel} / ${s} — ${monthLabel(month)}`,
                { cats: [sel], sub: s })} />
          </div>
        </div>
      </Card>

      <Card>
        <CardHead title="Mês vs. anterior — gastos por categoria"
          sub={`${monthLabel(month)} comparado ao mês anterior`} />
        <div className="overflow-x-auto px-2 pb-3">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-border text-left text-[11px]
                uppercase tracking-wide text-faint">
                <th className="px-4 py-2.5">Categoria</th>
                <th className="px-4 py-2.5 text-right">{monthLabel(month)}</th>
                <th className="px-4 py-2.5 text-right">Anterior</th>
                <th className="px-4 py-2.5 text-right">Variação</th>
              </tr>
            </thead>
            <tbody>
              {cmp.map((x) => (
                <tr key={x.c}
                  className="cursor-pointer border-b border-border/60
                    hover:bg-white/[0.03]"
                  onClick={() => setSelectedCat(x.c)}>
                  <td className="px-4 py-2">
                    <span className="flex items-center gap-2">
                      {(() => { const M = catMeta(x.c); return (
                        <M.Icon className="size-3.5"
                          style={{ color: M.color }} />) })()}
                      {x.c}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-right tnum">
                    <button onClick={(e) => { e.stopPropagation()
                      drill?.drill(`${x.c} — ${monthLabel(month)}`,
                        { cats: [x.c] }) }}
                      className="hover:text-green">{brl(x.a)}</button></td>
                  <td className="px-4 py-2 text-right tnum text-faint">
                    {brl(x.b)}</td>
                  <td className={`px-4 py-2 text-right tnum ${
                    x.d > 0 ? 'text-red' : x.d < 0 ? 'text-green' : 'text-faint'}`}>
                    {x.d === 0 ? '—'
                      : `${signedBrl(x.d)} (${fmtPct(x.p)})`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}
