import { subscriptionRows } from '../lib/subscriptions.js'
import { fullDate, monthLabel, signedBrl } from '../lib/format.js'
import { CategoryTag } from '../lib/categories.jsx'
import { Card, Badge } from './ui/primitives.jsx'
import { Pencil } from 'lucide-react'

export function Assinaturas({ txns, month, openEdit }) {
  const rows = subscriptionRows(txns)
  const total = rows.reduce((sum, row) => sum + row.amount, 0)

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-[17px] font-bold">Assinaturas — {monthLabel(month)}</h2>
        <p className="mt-1 text-[12px] text-faint">
          {rows.length} cobrança{rows.length === 1 ? '' : 's'} no período
        </p>
        <p className={`mt-1 text-[22px] font-bold tnum ${total < 0
          ? 'text-red' : 'text-green'}`}>{signedBrl(total)}</p>
      </div>

      <Card className="overflow-hidden">
        {rows.length === 0 ? (
          <div className="px-5 py-12 text-center text-[13px] text-faint">
            Nenhuma assinatura encontrada neste período.
          </div>
        ) : (
          <div className="divide-y divide-border">
            {rows.map((row) => (
              <div key={row.id}
                className="flex items-center justify-between gap-3 px-5 py-3
                  hover:bg-white/[0.03]">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1
                    text-[13px]">
                    <span className="shrink-0 text-[12px] text-faint">
                      {fullDate(row.transaction.date)}</span>
                    <span className="truncate font-medium">
                      {row.transaction.description}</span>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    <CategoryTag category={row.category}
                      subcategory="Assinaturas" size="xs" />
                    {row.isSplit && <Badge tone="violet">dividido</Badge>}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span className={`tnum text-[13px] font-semibold ${row.amount < 0
                    ? 'text-red' : 'text-green'}`}>{signedBrl(row.amount)}</span>
                  <button onClick={() => openEdit([row.transaction])}
                    className="rounded-lg p-1.5 text-muted hover:bg-surface2
                      hover:text-text" title="Editar">
                    <Pencil className="size-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  )
}
