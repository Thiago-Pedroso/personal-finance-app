import { useState } from 'react'
import { useData } from './lib/useData.js'
import { removeQueue, updateQueue } from './lib/api.js'
import { monthLabel } from './lib/format.js'
import { ToastProvider, useToast } from './components/ui/Toast.jsx'
import { DrillProvider } from './lib/useDrill.jsx'
import { Spinner, Button } from './components/ui/primitives.jsx'
import { Overview } from './components/Overview.jsx'
import { Categories } from './components/Categories.jsx'
import { Movements } from './components/Movements.jsx'
import { Planejamento } from './components/Planejamento.jsx'
import { Review } from './components/Review.jsx'
import { TransactionsTable } from './components/TransactionsTable.jsx'
import { EditModal } from './components/EditModal.jsx'
import { DrillDrawer } from './components/DrillDrawer.jsx'
import { RefreshCw, Wallet, MessageSquare } from 'lucide-react'

const TABS = [
  ['overview', 'Visão Geral'],
  ['txns', 'Transações'],
  ['cats', 'Categorias'],
  ['plan', 'Planejamento'],
  ['movs', 'Movimentações'],
  ['review', 'Revisar'],
]

function Shell() {
  const d = useData()
  const toast = useToast()
  const [tab, setTab] = useState('overview')
  const [selCat, setSelCat] = useState(null)
  const [txnPreset, setTxnPreset] = useState(null)
  const [edit, setEdit] = useState({ open: false, rows: [] })

  const openEdit = (rows) => setEdit({ open: true, rows })
  const closeEdit = () => setEdit((e) => ({ ...e, open: false }))
  // edição recarrega os dados (o pipeline recategoriza no servidor), mas
  // preservamos a rolagem pra não "pular" pro topo e perder o lugar.
  const onSaved = async (reload) => {
    const y = window.scrollY
    if (reload) await d.refresh()
    else await d.loadQueue()
    requestAnimationFrame(() =>
      requestAnimationFrame(() => window.scrollTo(0, y)))
  }
  const goCategory = (c) => { setSelCat(c); setTab('cats') }
  const goTxns = (c) => { setTxnPreset(c); setTab('txns') }
  const onRemoveQueue = async (i) => {
    try { await removeQueue(i); d.loadQueue(); toast('Removido da fila.', 'info') }
    catch (e) { toast(e.message, 'error') }
  }
  const onUpdateQueue = async (i, patch) => {
    try { await updateQueue(i, patch); await d.loadQueue()
      toast('Item da fila atualizado.', 'success') }
    catch (e) { toast(e.message, 'error') }
  }

  if (d.error && !d.dash) {
    return (
      <div className="mx-auto max-w-md px-6 py-32 text-center">
        <p className="text-red">⚠ {d.error}</p>
        <p className="mt-3 text-[13px] text-muted">
          Gere os relatórios: <code className="rounded bg-white/10 px-1.5
          py-0.5">uv run python -m finance.report</code>
        </p>
        <Button className="mt-5" onClick={d.refresh}>Tentar de novo</Button>
      </div>
    )
  }
  if (!d.dash || !d.view) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-3
        text-muted">
        <Spinner className="size-6" /> Carregando relatórios…
      </div>
    )
  }

  const { dash } = d
  const mdata = d.view
  const month = d.periodKey
  const pickMonth = (m) => { if (m) { d.setMode('month'); d.setMonth(m) } }
  // ids que estão na Fila do Claude — pra marcar as linhas nas tabelas
  const queuedIds = new Set(d.queue.flatMap((q) => q.ids || []))
  const pend = (dash.pending ?? dash.needs_review + dash.uncategorized)
    + d.queue.length

  return (
    <div className="mx-auto max-w-[1240px] px-5 pb-24 pt-7">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-[22px] font-bold
            tracking-tight">
            <Wallet className="size-5 text-green" /> Finance Control
          </h1>
          <p className="mt-1 text-[12px] text-faint">
            {dash.total_transactions} transações · atualizado{' '}
            {new Date(dash.generated_at).toLocaleString('pt-BR')}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {d.queue.length > 0 && (
            <button onClick={() => setTab('review')}
              className="flex items-center gap-2 rounded-xl border border-blue/40
                bg-blue/10 px-3 py-2 text-[13px] text-blue hover:bg-blue/20"
              title="Itens que você mandou pro Claude">
              <MessageSquare className="size-4" />
              Fila do Claude
              <span className="rounded-full bg-blue/25 px-1.5 text-[11px]
                font-bold">{d.queue.length}</span>
            </button>
          )}
          <div className="flex overflow-hidden rounded-xl border border-border
            text-[12.5px]">
            {['month', 'year'].map((mo) => (
              <button key={mo} onClick={() => d.setMode(mo)}
                className={`px-3 py-2 font-medium transition ${d.mode === mo
                  ? 'bg-green text-[#04130c]'
                  : 'bg-surface2 text-muted hover:text-text'}`}>
                {mo === 'month' ? 'Mês' : 'Ano'}
              </button>
            ))}
          </div>
          {d.mode === 'month' ? (
            <select value={d.month || ''}
              onChange={(e) => d.setMonth(e.target.value)}
              className="rounded-xl border border-border bg-surface2 px-3 py-2
                text-[13px] hover:border-faint">
              {[...dash.months].reverse().map((m) => (
                <option key={m.month} value={m.month}>
                  {monthLabel(m.month)}</option>
              ))}
            </select>
          ) : (
            <select value={d.year || ''}
              onChange={(e) => d.setYear(e.target.value)}
              className="rounded-xl border border-border bg-surface2 px-3 py-2
                text-[13px] hover:border-faint">
              {[...d.years].reverse().map((y) => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
          )}
          <Button variant="ghost" onClick={d.refresh} disabled={d.busy}>
            <RefreshCw className={`size-4 ${d.busy ? 'animate-[spin_.8s_linear_infinite]' : ''}`} />
            Atualizar
          </Button>
        </div>
      </header>

      <nav className="mt-6 flex flex-wrap gap-1 border-b border-border">
        {TABS.map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)}
            className={`relative px-4 py-2.5 text-[14px] font-semibold
              transition ${tab === k
                ? 'text-text' : 'text-muted hover:text-text'}`}>
            {label}
            {k === 'review' && pend > 0 && (
              <span className="ml-2 rounded-full bg-amber/20 px-1.5 text-[11px]
                font-bold text-amber">{pend}</span>
            )}
            {tab === k && <span className="absolute inset-x-3 -bottom-px h-0.5
              rounded-full bg-green" />}
          </button>
        ))}
      </nav>

      {d.error && (
        <div className="mt-4 rounded-xl border border-red/30 bg-red/10 px-4
          py-3 text-[13px] text-red">⚠ {d.error}</div>
      )}

      <main className="mt-6">
        {tab === 'overview' && (
          <Overview dash={dash} month={month} mdata={mdata}
            setMonth={pickMonth} goCategory={goCategory}
            goReview={() => setTab('review')} queue={d.queue} />
        )}
        {tab === 'txns' && (
          <TransactionsTable txns={mdata.transactions || []} openEdit={openEdit}
            presetCat={txnPreset} queuedIds={queuedIds}
            title={`Transações — ${monthLabel(month)}`} />
        )}
        {tab === 'cats' && (
          <Categories dash={dash} mdata={mdata} month={month}
            selectedCat={selCat} setSelectedCat={setSelCat} goTxns={goTxns} />
        )}
        {tab === 'plan' && (d.mode === 'year' ? (
          <div className="rounded-2xl border border-border bg-surface/80 px-6
            py-12 text-center text-[14px] text-muted">
            O planejamento é mensal. Selecione <b className="text-text">Mês</b>{' '}
            no topo para editar tetos, metas e ver o ritmo.
          </div>
        ) : (
          <Planejamento dash={dash} mdata={mdata} month={month}
            onSaved={d.refresh} />
        ))}
        {tab === 'movs' && (
          <Movements dash={dash} mdata={mdata} month={month} />
        )}
        {tab === 'review' && (
          <Review dash={dash} queue={d.queue} queuedIds={queuedIds}
            onRemoveQueue={onRemoveQueue} onUpdateQueue={onUpdateQueue}
            openEdit={openEdit} />
        )}
      </main>

      <DrillDrawer txns={mdata.transactions || []} openEdit={openEdit}
        queuedIds={queuedIds} />

      {edit.open && (
        <EditModal open={edit.open} onClose={closeEdit} txns={edit.rows}
          taxonomy={dash.taxonomy} allTxns={mdata.transactions || []}
          onSaved={onSaved} />
      )}
    </div>
  )
}

export default function App() {
  return (
    <ToastProvider>
      <DrillProvider>
        <Shell />
      </DrillProvider>
    </ToastProvider>
  )
}
