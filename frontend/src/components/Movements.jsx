import { Card } from './ui/primitives.jsx'
import { catMeta, SubcategoryTag } from '../lib/categories.jsx'
import { useDrill } from '../lib/useDrill.jsx'
import { brl, signedBrl, monthLabel, dayMonth } from '../lib/format.js'
import { SensitiveAmount } from './ui/SensitiveValue.jsx'
import { UserRound } from 'lucide-react'

// pendências de acerto do histórico inteiro, agrupadas por "Com quem"
function OpenSettlements({ groups }) {
  const drill = useDrill()
  if (!groups?.length) return null
  return (
    <Card className="p-5">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-[12px] font-semibold uppercase tracking-wider text-muted">
          Em aberto</h3>
        <span className="text-[11.5px] text-faint">
          Para fechar, selecione o lançamento e a entrada e clique em Abater</span>
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {groups.map((group) => (
          <button key={group.name} type="button"
            onClick={() => drill?.drill(`Em aberto com ${group.name}`,
              { ids: group.items.map((item) => item.id) })}
            className="rounded-xl border border-border bg-surface2/50 p-3 text-left
              hover:border-faint">
            <div className="flex items-center justify-between gap-2">
              <span className="flex min-w-0 items-center gap-1.5 font-semibold">
                <UserRound className="size-4 shrink-0 text-muted" />
                <span className="truncate">{group.name}</span>
              </span>
              <span className="text-right text-[12px]">
                {group.receivable > 0 && <div className="tnum text-green">
                  a receber <SensitiveAmount>{brl(group.receivable)}</SensitiveAmount>
                </div>}
                {group.payable > 0 && <div className="tnum text-amber">
                  a repassar <SensitiveAmount>{brl(group.payable)}</SensitiveAmount>
                </div>}
              </span>
            </div>
            <div className="mt-2 flex flex-col gap-0.5">
              {group.items.slice(0, 4).map((item) => (
                <div key={`${item.id}:${item.part ?? ''}`}
                  className="flex justify-between gap-3 text-[12px] text-muted">
                  <span className="truncate">
                    <span className="tnum mr-2 text-faint">{dayMonth(item.date)}</span>
                    {item.description}
                  </span>
                  <span className="tnum shrink-0">
                    <SensitiveAmount>{brl(item.open)}</SensitiveAmount></span>
                </div>
              ))}
              {group.items.length > 4 && (
                <div className="text-[11.5px] text-faint">
                  +{group.items.length - 4} outros</div>
              )}
            </div>
          </button>
        ))}
      </div>
    </Card>
  )
}

export function Movements({ dash, mdata, month }) {
  const drill = useDrill()
  // só categorias de tratamento "movimento" (poupança tem visão própria)
  const cats = dash.movimento_cats || dash.cashflow_excludes || []
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
        (Reserva), comissão de formatura, dinheiro de terceiros,
        aportes/resgates e transferências entre contas. Aparece para auditoria,
        mas <b className="text-text">não</b> entra em Receitas nem Gastos.
      </Card>

      <OpenSettlements groups={dash.open_settlements} />

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
                className={`mt-2 block text-[22px] font-bold tnum
                  hover:opacity-80 ${net >= 0 ? 'text-green' : 'text-red'}`}>
                <SensitiveAmount>{signedBrl(net)}</SensitiveAmount></button>
              <div className="mt-1 flex gap-4 text-[12.5px] text-muted">
                <span className="text-green">entrou{' '}
                  <SensitiveAmount>{brl(cm.in)}</SensitiveAmount></span>
                <span className="text-red">saiu{' '}
                  <SensitiveAmount>{brl(cm.out)}</SensitiveAmount></span>
              </div>
              {subs.length > 0 && (
                <div className="mt-3 flex flex-col gap-1 border-t border-dashed
                  border-border pt-2 text-[12.5px] text-muted">
                  {subs.map((x) => (
                    <button key={x.s} onClick={() => drill?.drill(
                      `${c} / ${x.s} — ${monthLabel(month)}`,
                      { cats: [c], sub: x.s })}
                      className="flex justify-between hover:text-text">
                      <SubcategoryTag category={c} subcategory={x.s} size="xs" />
                      <span className={`tnum ${x.net >= 0 ? 'text-green'
                        : 'text-red'}`}>
                        <SensitiveAmount>{signedBrl(x.net)}</SensitiveAmount>
                      </span>
                    </button>
                  ))}
                </div>
              )}
              <div className="mt-3 flex justify-between border-t border-border
                pt-2 text-[12px] text-faint">
                <span>acumulado {dash.months.length}m · {ca.count}x</span>
                <span className={`tnum ${ca.in - ca.out >= 0 ? 'text-green'
                  : 'text-red'}`}>
                  <SensitiveAmount>{signedBrl(ca.in - ca.out)}</SensitiveAmount>
                </span>
              </div>
            </Card>
          )
        })}
      </div>
    </div>
  )
}
