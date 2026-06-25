import { useMemo, useState } from 'react'
import { Card, CardHead, Button, Badge } from './ui/primitives.jsx'
import { inputCls } from './ui/MultiSelect.jsx'
import { useToast } from './ui/Toast.jsx'
import { useDrill } from '../lib/useDrill.jsx'
import { catMeta } from '../lib/categories.jsx'
import { postBudget } from '../lib/api.js'
import { brl, brl0, signedBrl, monthLabel } from '../lib/format.js'
import {
  Save, RotateCcw, Wand2, Plus, Trash2, TrendingUp, AlertTriangle,
  Info, Repeat,
} from 'lucide-react'

const STATUS = {
  estourou: ['Estourou', 'text-red', '#f4685f'],
  estourando: ['Estourando', 'text-amber', '#e0a93b'],
  no_caminho: ['No caminho', 'text-green', '#36c98b'],
  folgado: ['Folgado', 'text-green', '#36c98b'],
  sem_teto: ['Sem teto', 'text-faint', '#5d6b7a'],
}
const clone = (o) => JSON.parse(JSON.stringify(o || {}))

export function Planejamento({ dash, mdata, month, onSaved }) {
  const t = useToast()
  const drill = useDrill()
  const plan = mdata.plan || { categories: [], total_planned: 0 }
  const sav = mdata.savings || { goals: [], pct: null }

  const base = useMemo(() => {
    const b = clone(dash.budgets)
    b.income_plan ??= { recurring: 0, months: {} }
    b.spending ??= { recurring: {}, months: {} }
    b.spending.recurring ??= {}
    b.spending.months ??= {}
    b.savings_goals ??= []
    return b
  }, [dash.budgets])
  const [d, setD] = useState(base)
  const [saving, setSaving] = useState(false)
  const dirty = JSON.stringify(d) !== JSON.stringify(base)

  const catList = useMemo(() => {
    const ex = new Set(dash.cashflow_excludes || [])
    const s = new Set(Object.keys(dash.taxonomy || {}).filter((c) => !ex.has(c)))
    plan.categories.forEach((r) => s.add(r.category))
    Object.keys(d.spending.recurring).forEach((c) => s.add(c))
    return [...s].sort()
  }, [dash, plan, d])

  const realizedOf = (c) =>
    plan.categories.find((r) => r.category === c) || {}
  const ov = d.spending.months[month] || {}
  const eff = (c) => (ov[c] ?? d.spending.recurring[c] ?? 0)

  const setRec = (c, v) => setD((s) => {
    const n = clone(s); const x = parseFloat(v)
    if (v === '' || isNaN(x)) delete n.spending.recurring[c]
    else n.spending.recurring[c] = x
    return n
  })
  const setOv = (c, v) => setD((s) => {
    const n = clone(s); const x = parseFloat(v)
    n.spending.months[month] ??= {}
    if (v === '' || isNaN(x)) delete n.spending.months[month][c]
    else n.spending.months[month][c] = x
    if (!Object.keys(n.spending.months[month]).length)
      delete n.spending.months[month]
    return n
  })
  const setIncome = (k, v) => setD((s) => {
    const n = clone(s); const x = parseFloat(v)
    if (k === 'rec') n.income_plan.recurring = isNaN(x) ? 0 : x
    else {
      n.income_plan.months ??= {}
      if (v === '' || isNaN(x)) delete n.income_plan.months[month]
      else n.income_plan.months[month] = x
    }
    return n
  })

  function suggestFromAvg() {
    const past = dash.months.filter((m) => m.month <= month).slice(-12)
    const sum = {}, cnt = {}
    past.forEach((m) => Object.entries(m.by_category || {}).forEach(([c, v]) => {
      if (v.expense > 0) { sum[c] = (sum[c] || 0) + v.expense; cnt[c] = (cnt[c] || 0) + 1 }
    }))
    setD((s) => {
      const n = clone(s)
      catList.forEach((c) => {
        if (sum[c]) n.spending.recurring[c] = Math.round(sum[c] / cnt[c] / 10) * 10
      })
      return n
    })
    t('Tetos sugeridos pela média — revise e salve.', 'info')
  }

  async function save() {
    setSaving(true)
    try { await postBudget(d); t('Planejamento salvo.', 'success'); onSaved() }
    catch (e) { t('Erro: ' + e.message, 'error', 7000) }
    finally { setSaving(false) }
  }

  const incPlan = (d.income_plan.months?.[month] ?? d.income_plan.recurring) || 0
  const totPlanned = catList.reduce((a, c) => a + (+eff(c) || 0), 0)
  const totReal = plan.total_realized || 0
  const sevIcon = { alert: AlertTriangle, warn: AlertTriangle, info: Info }

  return (
    <div className="flex flex-col gap-4">
      {/* barra de ação */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-[17px] font-bold">Planejamento — {monthLabel(month)}</h2>
          <p className="text-[12px] text-faint">
            Tetos por categoria (todo mês ou só este), renda esperada, metas e ritmo.
          </p>
        </div>
        <div className="flex gap-2">
          <Button onClick={suggestFromAvg}><Wand2 className="size-4" />
            Sugerir pela média</Button>
          {dirty && (
            <Button variant="ghost" onClick={() => setD(base)}>
              <RotateCcw className="size-4" /> Desfazer</Button>
          )}
          <Button variant="primary" disabled={!dirty || saving} onClick={save}>
            <Save className="size-4" /> {saving ? 'Salvando…' : 'Salvar'}
          </Button>
        </div>
      </div>

      {/* totais */}
      <div className="grid gap-4 md:grid-cols-4">
        {[
          ['Renda planejada', brl(incPlan), 'text-text',
            `realizada ${brl(plan.income_realized || 0)}`],
          ['Total dos tetos', brl(totPlanned), 'text-text',
            `realizado ${brl(totReal)}`],
          ['Saldo planejado', signedBrl(incPlan - totPlanned),
            incPlan - totPlanned >= 0 ? 'text-green' : 'text-red',
            `projetado ${signedBrl(plan.projected_balance || 0)}`],
          ['Pode gastar/dia', brl(plan.daily_allowed || 0), 'text-blue',
            `${plan.days_left ?? 0} dias restantes`],
        ].map(([l, v, c, s]) => (
          <Card key={l} className="p-4">
            <div className="text-[11px] font-semibold uppercase tracking-wider
              text-muted">{l}</div>
            <div className={`mt-1 text-[22px] font-bold ${c}`}>{v}</div>
            <div className="mt-0.5 text-[12px] text-faint">{s}</div>
          </Card>
        ))}
      </div>

      {/* renda esperada */}
      <Card className="p-5">
        <h3 className="text-[13px] font-semibold uppercase tracking-wider
          text-muted">Renda esperada</h3>
        <div className="mt-3 flex flex-wrap gap-5">
          <label className="text-[12px] text-muted">Todo mês (recorrente)
            <input type="number" value={d.income_plan.recurring || ''}
              onChange={(e) => setIncome('rec', e.target.value)}
              className={inputCls('mt-1 block w-44')} placeholder="0" />
          </label>
          <label className="text-[12px] text-muted">
            Só em {monthLabel(month)} (override)
            <input type="number" value={d.income_plan.months?.[month] ?? ''}
              onChange={(e) => setIncome('mon', e.target.value)}
              className={inputCls('mt-1 block w-44')} placeholder="usa recorrente" />
          </label>
        </div>
      </Card>

      {/* tetos por categoria */}
      <Card>
        <CardHead title="Tetos por categoria"
          sub="edite o teto; clique no realizado para ver os lançamentos" />
        <div className="overflow-x-auto px-2 pb-3">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-border text-left text-[11px]
                uppercase tracking-wide text-faint">
                <th className="px-3 py-2">Categoria</th>
                <th className="px-3 py-2 w-36">Teto/mês</th>
                <th className="px-3 py-2 w-36">Só {monthLabel(month)}</th>
                <th className="px-3 py-2 text-right">Realizado</th>
                <th className="px-3 py-2 text-right">Falta</th>
                <th className="px-3 py-2 w-[26%]">Ritmo</th>
              </tr>
            </thead>
            <tbody>
              {catList.map((c) => {
                const r = realizedOf(c)
                const planned = +eff(c) || 0
                const realized = r.realized || 0
                const proj = r.projected ?? realized
                const [lab, tcol, bar] = STATUS[r.status || (planned
                  ? 'no_caminho' : 'sem_teto')] || STATUS.sem_teto
                const pctR = planned ? Math.min(realized / planned * 100, 100) : 0
                const pctP = planned
                  ? Math.min(proj / planned * 100, 100) : 0
                return (
                  <tr key={c} className="border-b border-border/60">
                    <td className="px-3 py-2 font-medium">
                      <span className="flex items-center gap-2">
                        {(() => { const M = catMeta(c); return (
                          <M.Icon className="size-3.5"
                            style={{ color: M.color }} />) })()}
                        {c}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <input type="number" value={d.spending.recurring[c] ?? ''}
                        onChange={(e) => setRec(c, e.target.value)}
                        placeholder="—"
                        className={inputCls('w-28 py-1')} />
                    </td>
                    <td className="px-3 py-2">
                      <input type="number" value={ov[c] ?? ''}
                        onChange={(e) => setOv(c, e.target.value)}
                        placeholder="herda"
                        className={inputCls('w-28 py-1')} />
                    </td>
                    <td className="px-3 py-2 text-right">
                      <button onClick={() => drill?.drill(
                        `${c} — ${monthLabel(month)}`, { cats: [c], flow: 'out' })}
                        className="tnum font-medium hover:text-green">
                        {brl(realized)}</button>
                    </td>
                    <td className={`px-3 py-2 text-right tnum ${
                      planned && realized > planned ? 'text-red' : 'text-muted'}`}>
                      {planned ? signedBrl(planned - realized) : '—'}</td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        <div className="relative h-2 flex-1 overflow-hidden
                          rounded-full bg-white/[0.06]">
                          <div className="absolute inset-y-0 left-0 rounded-full
                            opacity-30" style={{ width: `${pctP}%`,
                              background: bar }} />
                          <div className="absolute inset-y-0 left-0 rounded-full"
                            style={{ width: `${pctR}%`, background: bar }} />
                        </div>
                        <span className={`w-20 text-right text-[11px] ${tcol}`}>
                          {lab}</span>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* metas de poupança */}
        <Card>
          <CardHead title="Metas de poupança"
            sub={`Reserva — líquido no período ${signedBrl(
              sav.reserva_net_period || 0)}`}
            right={<Button variant="ghost" onClick={() => setD((s) => {
              const n = clone(s)
              n.savings_goals = [...(n.savings_goals || []),
                { name: 'Nova meta', target: 0, current: 0 }]
              return n
            })}><Plus className="size-4" /> Meta</Button>} />
          <div className="flex flex-col gap-3 px-5 pb-5">
            {(d.savings_goals || []).length === 0 && (
              <p className="py-4 text-center text-[13px] text-faint">
                Sem metas. Adicione uma (ex.: Reserva de emergência).</p>
            )}
            {(d.savings_goals || []).map((g, idx) => {
              const pct = g.target > 0
                ? Math.min(g.current / g.target * 100, 100) : 0
              return (
                <div key={idx} className="rounded-xl border border-border
                  bg-surface2/40 p-3">
                  <div className="flex items-center gap-2">
                    <input value={g.name}
                      onChange={(e) => setD((s) => { const n = clone(s)
                        n.savings_goals[idx].name = e.target.value; return n })}
                      className={inputCls('flex-1 py-1')} />
                    <button onClick={() => setD((s) => { const n = clone(s)
                      n.savings_goals.splice(idx, 1); return n })}
                      className="rounded-lg p-1.5 text-muted hover:bg-surface2
                        hover:text-red"><Trash2 className="size-4" /></button>
                  </div>
                  <div className="mt-2 flex gap-3">
                    <label className="text-[11px] text-muted">Tenho hoje
                      <input type="number" value={g.current || ''}
                        onChange={(e) => setD((s) => { const n = clone(s)
                          n.savings_goals[idx].current = +e.target.value || 0
                          return n })}
                        className={inputCls('mt-0.5 block w-32 py-1')} />
                    </label>
                    <label className="text-[11px] text-muted">Meta
                      <input type="number" value={g.target || ''}
                        onChange={(e) => setD((s) => { const n = clone(s)
                          n.savings_goals[idx].target = +e.target.value || 0
                          return n })}
                        className={inputCls('mt-0.5 block w-32 py-1')} />
                    </label>
                    <div className="flex-1 self-end">
                      <div className="mb-1 text-right text-[11px] text-muted">
                        {pct.toFixed(0)}%</div>
                      <div className="h-2 overflow-hidden rounded-full
                        bg-white/[0.06]">
                        <div className="h-full rounded-full bg-violet"
                          style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </Card>

        {/* insights */}
        <Card>
          <CardHead title="Insights" sub={`gerados de ${monthLabel(month)}`} />
          <div className="flex flex-col gap-2 px-5 pb-5">
            {(mdata.insights || []).length === 0 && (
              <p className="py-4 text-center text-[13px] text-faint">
                Sem alertas neste mês.</p>
            )}
            {(mdata.insights || []).map((ins, k) => {
              const I = sevIcon[ins.sev] || Info
              const col = ins.sev === 'alert' ? 'text-red border-red/30 bg-red/[0.06]'
                : ins.sev === 'warn' ? 'text-amber border-amber/30 bg-amber/[0.06]'
                  : 'text-muted border-border bg-surface2/40'
              return (
                <div key={k} className={`flex items-start gap-2.5 rounded-xl
                  border px-3 py-2.5 text-[13px] ${col}`}>
                  <I className="mt-0.5 size-4 shrink-0" />
                  <span className="text-text">{ins.text}</span>
                </div>
              )
            })}
          </div>
        </Card>
      </div>

      {/* recorrências */}
      <Card>
        <CardHead title={`Recorrências detectadas (${(dash.recurring || []).length})`}
          sub="assinaturas/contas regulares — clique para ver os lançamentos" />
        <div className="overflow-x-auto px-2 pb-3">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-border text-left text-[11px]
                uppercase tracking-wide text-faint">
                <th className="px-3 py-2">Descrição</th>
                <th className="px-3 py-2">Categoria</th>
                <th className="px-3 py-2">Cadência</th>
                <th className="px-3 py-2 text-right">Valor típico</th>
                <th className="px-3 py-2 text-right">Ocorrências</th>
                <th className="px-3 py-2">Último</th>
              </tr>
            </thead>
            <tbody>
              {(dash.recurring || []).map((r, k) => (
                <tr key={k} className="cursor-pointer border-b border-border/60
                  hover:bg-white/[0.03]"
                  onClick={() => drill?.drill(r.label,
                    { q: r.label.slice(0, 18) })}>
                  <td className="px-3 py-2 font-medium">{r.label}</td>
                  <td className="px-3 py-2"><Badge>{r.category}</Badge></td>
                  <td className="px-3 py-2">
                    <span className="flex items-center gap-1.5 text-muted">
                      <Repeat className="size-3.5" />{r.cadence}</span></td>
                  <td className="px-3 py-2 text-right tnum">{brl(r.amount)}</td>
                  <td className="px-3 py-2 text-right tnum text-muted">
                    {r.count}x · {r.months}m</td>
                  <td className="px-3 py-2 text-muted">{r.last_date}</td>
                </tr>
              ))}
              {(dash.recurring || []).length === 0 && (
                <tr><td colSpan={6} className="py-8 text-center text-faint">
                  Nada detectado ainda.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}
