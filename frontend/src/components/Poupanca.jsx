import { Card } from './ui/primitives.jsx'
import { catMeta } from '../lib/categories.jsx'
import { useDrill } from '../lib/useDrill.jsx'
import { brl, signedBrl, monthLabel } from '../lib/format.js'
import { PiggyBank } from 'lucide-react'

// Poupança = balde próprio. "Poupado" = aportes − resgates, EXCLUINDO rendimento
// (rendimento só cresce o patrimônio; bate com o `saved` do backend). Aporte lê como
// POSITIVO/bom (violeta) — a cor é "bom/ruim pro objetivo", não "entrou/saiu".
const isRend = (s) => (s || '').toLowerCase().includes('rendiment')

// Poupado = só APORTES (saídas pra poupança, v.out). Resgate (v.in) é mostrado à parte,
// NÃO entra no poupado — tirar de um cofrinho não é poupar. Rendimento idem.
function split(bucket) {
  let poupado = 0, resgatado = 0, rendimento = 0
  for (const [s, v] of Object.entries(bucket.subcategories || {})) {
    if (isRend(s)) { rendimento += (v.out || 0) - (v.in || 0) } else {
      poupado += v.out || 0
      resgatado += v.in || 0
    }
  }
  return { poupado, resgatado, rendimento }
}

export function Poupanca({ dash, mdata, month }) {
  const drill = useDrill()
  const cats = dash.poupanca_cats || []

  // acumulado no histórico, também separando rendimento
  const agg = {}
  cats.forEach((c) => (agg[c] = { poupado: 0, rendimento: 0, count: 0 }))
  dash.months.forEach((m) =>
    Object.entries(m.poupanca || {}).forEach(([c, v]) => {
      agg[c] = agg[c] || { poupado: 0, rendimento: 0, count: 0 }
      const s = split(v)
      agg[c].poupado += s.poupado; agg[c].rendimento += s.rendimento
      agg[c].count += v.count || 0
    }))
  const present = cats.filter(
    (c) => (mdata.poupanca || {})[c] || agg[c].poupado || agg[c].rendimento)

  const saved = mdata.saved || 0
  const income = mdata.income || 0
  const taxa = income >= 1 ? Math.round((saved / income) * 100) : null

  return (
    <div className="flex flex-col gap-4">
      <Card className="flex flex-col gap-4 border-violet/25 bg-violet/[0.05] p-5
        sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wider
            text-faint">Poupado — {monthLabel(month)}</div>
          <div className="mt-1 flex items-baseline gap-2">
            <button onClick={() => drill?.drill(
              `Poupança — ${monthLabel(month)}`, { cats })}
              className={`text-[30px] font-bold tnum hover:opacity-80 ${
                saved >= 0 ? 'text-violet' : 'text-red'}`}
              title="Ver lançamentos de poupança">{signedBrl(saved)}</button>
            {taxa != null && (
              <span className="text-[13px] text-muted">· {taxa}% da renda</span>
            )}
          </div>
          <p className="mt-1 max-w-xl text-[12.5px] text-faint">
            Só os <b className="text-muted">aportes</b> — o que você direcionou pra
            poupança. Resgate (tirar do cofrinho) e rendimento <b className="text-muted">
            não contam</b>, e nada disso é gasto.
          </p>
        </div>
        <span className="grid size-12 shrink-0 place-items-center rounded-2xl
          bg-violet/10 text-violet ring-1 ring-violet/20">
          <PiggyBank className="size-6" /></span>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {present.length === 0 && (
          <Card className="p-8 text-center text-[13px] text-faint sm:col-span-2
            xl:col-span-3">Nada em poupança neste período.</Card>
        )}
        {present.map((c) => {
          const cm = (mdata.poupanca || {})[c]
            || { in: 0, out: 0, count: 0, subcategories: {} }
          const s = split(cm)
          const M = catMeta(c)
          return (
            <Card key={c} className="p-5">
              <div className="flex items-center justify-between">
                <h3 className="flex items-center gap-2 text-[15px] font-semibold">
                  <span className="grid size-7 place-items-center rounded-lg"
                    style={{ background: M.color + '1f', color: M.color }}>
                    <M.Icon className="size-4" /></span>{c}</h3>
                <span className="text-[12px] text-faint">{monthLabel(month)}</span>
              </div>
              <button onClick={() => drill?.drill(
                `${c} — ${monthLabel(month)}`, { cats: [c] })}
                className="mt-2 block text-left hover:opacity-80"
                title="Ver lançamentos">
                <span className="text-[22px] font-bold tnum text-violet">
                  {brl(s.poupado)}</span>
                <span className="ml-2 text-[12px] text-faint">aportado</span>
              </button>
              {(s.resgatado > 0 || s.rendimento !== 0) && (
                <div className="mt-3 flex flex-col gap-1 border-t border-dashed
                  border-border pt-2 text-[12.5px]">
                  {s.resgatado > 0 && (
                    <div className="flex justify-between">
                      <span className="text-muted">Resgatado{' '}
                        <span className="text-faint">(não conta)</span></span>
                      <span className="tnum text-faint">{brl(s.resgatado)}</span>
                    </div>
                  )}
                  {s.rendimento !== 0 && (
                    <div className="flex justify-between">
                      <span className="text-muted">Rendimento{' '}
                        <span className="text-faint">(fora do poupado)</span></span>
                      <span className="tnum text-green">{signedBrl(s.rendimento)}</span>
                    </div>
                  )}
                </div>
              )}
              <div className="mt-3 flex justify-between border-t border-border pt-2
                text-[12px] text-faint">
                <span>aportado acum. {dash.months.length}m · {agg[c].count}x</span>
                <span className="tnum text-violet">{brl(agg[c].poupado)}</span>
              </div>
            </Card>
          )
        })}
      </div>
    </div>
  )
}
