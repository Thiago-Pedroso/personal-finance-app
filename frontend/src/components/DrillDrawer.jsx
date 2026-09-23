import { Drawer } from './ui/Drawer.jsx'
import { TransactionsTable } from './TransactionsTable.jsx'
import { useDrill } from '../lib/useDrill.jsx'

// Slide-over global: qualquer número do dashboard abre aqui as transações
// que o compõem (progressive disclosure), com a tabela completa + edição.
export function DrillDrawer({ txns, openEdit, openReimburse, saveEdit, queuedIds,
  treatments }) {
  const d = useDrill()
  if (!d) return null
  return (
    <Drawer open={d.open} onOpenChange={(o) => !o && d.close()}
      title={d.title || 'Transações'} sub="filtrado a partir do número clicado">
      {d.open && (
        <TransactionsTable txns={txns} openEdit={openEdit}
          openReimburse={openReimburse} saveEdit={saveEdit}
          compact queuedIds={queuedIds} treatments={treatments}
          title="Lançamentos" initialFilter={d.filter} />
      )}
    </Drawer>
  )
}
