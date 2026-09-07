import { useEffect, useState } from 'react'
import { ArrowRight, TrendingUp } from 'lucide-react'

import { getInvestPending } from '../../lib/api.js'
import { brl } from '../../lib/format.js'
import { Card, CardHead } from '../ui/primitives.jsx'

const TONE = {
  unallocated_contribution: 'border-blue/30 bg-blue/[0.06]',
  income_quantity_mismatch: 'border-amber/30 bg-amber/[0.07]',
  quantity_mismatch: 'border-amber/30 bg-amber/[0.07]',
  balance_update: 'border-border bg-surface2/50',
  unknown_asset: 'border-violet/30 bg-violet/[0.07]',
}
const LABEL = {
  unallocated_contribution: 'Aporte sem destino',
  income_quantity_mismatch: 'Provento não confere',
  quantity_mismatch: 'Posição diverge da corretora',
  balance_update: 'Saldo novo na corretora',
  unknown_asset: 'Ativo fora da carteira',
}

// As pendências de investimento aparecem onde já se revisa o extrato, em vez de num
// lugar novo. Quem resolve é o espaço Investimentos; aqui elas só chamam.
export function InvestPendingCards() {
  const [items, setItems] = useState([])

  useEffect(() => {
    getInvestPending()
      .then((data) => setItems(data.pending || []))
      .catch(() => setItems([]))
  }, [])

  if (!items.length) return null

  return (
    <Card>
      <CardHead title="Investimentos"
        sub={`${items.length} ponto(s) para resolver na conferência com as corretoras`}
        right={<TrendingUp className="size-4 text-muted" />} />
      <div className="flex flex-col gap-2 px-5 pb-5">
        {items.map((item, index) => (
          <div key={index}
            className={`rounded-xl border px-4 py-3 ${TONE[item.kind] || 'border-border'}`}>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-faint">
              {LABEL[item.kind] || item.kind}</p>
            <p className="mt-1 text-[13px] text-muted">{item.message}</p>
            {item.suggested_ticker && (
              <p className="mt-1 flex items-center gap-1.5 text-[12px] text-brand-soft">
                <ArrowRight className="size-3" /> sugestão: {item.suggested_ticker}
              </p>
            )}
            {item.amount != null && (
              <p className="tnum mt-1 text-[12px] text-faint">{brl(item.amount)}</p>
            )}
          </div>
        ))}
        <a href="#/investimentos/operacoes"
          className="mt-1 self-start text-[13px] font-semibold text-brand
            hover:underline">
          Abrir Movimentações →
        </a>
      </div>
    </Card>
  )
}
