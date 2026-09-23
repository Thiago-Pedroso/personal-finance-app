import { useEffect, useState } from 'react'
import { ExternalLink, ShieldCheck, TrendingUp } from 'lucide-react'

import { getInvestPending } from '../../lib/api.js'
import { Card, CardHead } from '../ui/primitives.jsx'

const TONE = {
  income_quantity_mismatch: 'border-amber/30 bg-amber/[0.07]',
  quantity_mismatch: 'border-amber/30 bg-amber/[0.07]',
  balance_update: 'border-border bg-surface2/50',
  unknown_asset: 'border-violet/30 bg-violet/[0.07]',
  statement_missing: 'border-amber/30 bg-amber/[0.07]',
  destination_missing: 'border-amber/30 bg-amber/[0.07]',
  destination_partial: 'border-amber/30 bg-amber/[0.07]',
  destination_over: 'border-red/30 bg-red/[0.07]',
  orphan_link: 'border-red/30 bg-red/[0.07]',
}
const LABEL = {
  income_quantity_mismatch: 'Provento não confere',
  quantity_mismatch: 'Posição diverge da corretora',
  balance_update: 'Saldo novo na corretora',
  unknown_asset: 'Ativo fora da carteira',
  statement_missing: 'Extrato faltando',
  destination_missing: 'Aporte sem destino',
  destination_partial: 'Destino incompleto',
  destination_over: 'Destino maior que o lançamento',
  orphan_link: 'Ligação sem lançamento',
}
// o destino é conferido ao vivo no relatório; o arquivo da conferência só guarda o resto
const LIVE_KINDS = ['destination_missing', 'destination_partial', 'destination_over',
  'orphan_link']

// As pendências de investimento aparecem onde já se revisa o extrato, em vez de num
// lugar novo. Quem resolve é o espaço Investimentos; aqui elas só chamam.
export function InvestPendingCards() {
  const [items, setItems] = useState([])

  useEffect(() => {
    getInvestPending()
      .then((data) => setItems((data.pending || [])
        .filter((item) => !LIVE_KINDS.includes(item.kind))))
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

// Conferência entre o Fluxo e a carteira: destino de cada aporte e extrato em dia.
export function InvestAuditCard({ audit, pending, onOpenLedger }) {
  const statements = (pending?.pending || [])
    .filter((item) => item.kind === 'statement_missing')
  const items = [...(audit || []), ...statements]
  if (!items.length) return null
  return (
    <Card>
      <CardHead title="Ligação com o Fluxo"
        sub={`${items.length} ponto(s) para conferir`}
        right={<ShieldCheck className="size-4 text-muted" />} />
      <div className="flex flex-col gap-2 px-5 pb-5">
        {items.map((item, index) => (
          <div key={index}
            className={`rounded-xl border px-4 py-3 ${TONE[item.kind] || 'border-border'}`}>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-faint">
              {LABEL[item.kind] || item.kind}</p>
            <p className="mt-1 text-[13px] text-muted">{item.message}</p>
            {item.ledger_id && item.kind !== 'orphan_link' && onOpenLedger && (
              <button type="button"
                onClick={() => onOpenLedger({ ledger_id: item.ledger_id, date: item.date })}
                className="mt-1.5 inline-flex items-center gap-1 text-[12px] font-semibold
                  text-brand hover:underline">
                Definir destino no Fluxo <ExternalLink className="size-3" />
              </button>
            )}
          </div>
        ))}
      </div>
    </Card>
  )
}
