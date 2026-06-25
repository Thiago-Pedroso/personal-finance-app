import { Card } from './ui/primitives.jsx'
import { catMeta } from '../lib/categories.jsx'
import { useDrill } from '../lib/useDrill.jsx'
import { brl, signedBrl, monthLabel } from '../lib/format.js'

export function Movements({ dash, mdata, month }) {
  const drill = useDrill()
  const cats = dash.cashflow_excludes || []
  const agg = {}
  cats.forEach((c) => (agg[c] = { in: 0, out: 0, count: 0 }))
  dash.months.forEach((m) =>
    Object.entries(m.movements || {}).forEach(([c, v]) => {
      agg[c] = agg[c] || { in: 0, out: 0, count: 0 }
      agg[c].in += v.in; agg[c].out += v.out; agg[c].count += v.count
    }))
  const present = cats.filter(
    (c) => (mdata.movements || {})[c] || agg[c].in || agg[c].out)

  return (
    <div className="flex flex-col gap-4">
      <Card className="border-blue/25 bg-blue/[0.05] px-5 py-4 text-[13px]
        text-muted">
        <b className="text-text">Dinheiro fora do fluxo de caixa.</b> Cofrinhos
        (Reserva), comissão de formatura, rateios reembolsáveis (Compartilhado),
        aportes/resgates e transferências entre contas. Aparece para auditoria,
        mas <b className="text-text">não</b> entra em Receitas nem Gastos.
      </Card>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {present.map((c) => {
          const cm = (mdata.movements || {})[c]
            || { in: 0, out: 0, count: 0, subcategories: {} }
          const ca = agg[c]
          const net = cm.in - cm.out
          const subs = Object.entries(cm.subcategories || {})
            .map(([s, v]) => ({ s, net: v.in - v.out }))
            .sort((a, b) => Math.abs(b.net) - Math.abs(a.net))
          const M = catMeta(c)
          return (
            <Card key={c} className="p-5">
              <div className="flex items-center justify-between">
                <h3 className="flex items-center gap-2 text-[15px] font-semibold">
                  <span className="grid size-7 place-items-center rounded-lg"
                    style={{ background: M.color + '1f', color: M.color }}>
                    <M.Icon className="size-4" />
                  </span>{c}</h3>
                <span className="text-[12px] text-faint">{monthLabel(month)}</span>
              </div>
              <button onClick={() => drill?.drill(
                `${c} — ${monthLabel(month)}`, { cats: [c] })}
                className={`mt-2 block text-[22px] font-bold hover:opacity-80 ${
                  net >= 0 ? 'text-green' : 'text-red'}`}>
                {signedBrl(net)}</button>
              <div className="mt-1 flex gap-4 text-[12.5px] text-muted">
                <span className="text-green">entrou {brl(cm.in)}</span>
                <span className="text-red">saiu {brl(cm.out)}</span>
              </div>
              {subs.length > 0 && (
                <div className="mt-3 flex flex-col gap-1 border-t border-dashed
                  border-border pt-2 text-[12.5px] text-muted">
                  {subs.map((x) => (
                    <button key={x.s} onClick={() => drill?.drill(
                      `${c} / ${x.s} — ${monthLabel(month)}`,
                      { cats: [c], sub: x.s })}
                      className="flex justify-between hover:text-text">
                      <span>{x.s}</span>
                      <span className={`tnum ${x.net >= 0 ? 'text-green'
                        : 'text-red'}`}>{signedBrl(x.net)}</span>
                    </button>
                  ))}
                </div>
              )}
              <div className="mt-3 flex justify-between border-t border-border
                pt-2 text-[12px] text-faint">
                <span>acumulado 13m · {ca.count}x</span>
                <span className={`tnum ${ca.in - ca.out >= 0 ? 'text-green'
                  : 'text-red'}`}>{signedBrl(ca.in - ca.out)}</span>
              </div>
            </Card>
          )
        })}
      </div>
    </div>
  )
}
