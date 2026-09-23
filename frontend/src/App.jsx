import { useState } from 'react'
import { useData } from './lib/useData.js'
import { removeQueue, updateQueue } from './lib/api.js'
import { monthLabel } from './lib/format.js'
import { ToastProvider, useToast } from './components/ui/Toast.jsx'
import { DrillProvider } from './lib/useDrill.jsx'
import { PrivacyProvider, usePrivacy } from './lib/usePrivacy.jsx'
import { Spinner, Button } from './components/ui/primitives.jsx'
import { Overview } from './components/Overview.jsx'
import { Categories } from './components/Categories.jsx'
import { Tags } from './components/Tags.jsx'
import { Movements } from './components/Movements.jsx'
import { Planejamento } from './components/Planejamento.jsx'
import { Tools } from './components/Tools.jsx'
import { Poupanca } from './components/Poupanca.jsx'
import { Review } from './components/Review.jsx'
import { Rules } from './components/Rules.jsx'
import { TransactionsTable } from './components/TransactionsTable.jsx'
import { EditModal } from './components/EditModal.jsx'
import { ReimburseModal } from './components/ReimburseModal.jsx'
import { DrillDrawer } from './components/DrillDrawer.jsx'
import { Eye, EyeOff, RefreshCw, Wallet, MessageSquare, TrendingUp }
  from 'lucide-react'
import { InvestSpace, INVEST_TABS } from './components/invest/InvestSpace.jsx'
import { useSpace } from './lib/useSpace.js'

// Dois espaços lado a lado, em vez de um menu escondido atrás do título: o contador de
// pendências de cada lado é o que traz a pessoa de volta, e some num dropdown.
const SPACE_TABS = [
  ['financas', 'Finanças', Wallet],
  ['investimentos', 'Investimentos', TrendingUp],
]

const TABS = [
  ['overview', 'Visão Geral'],
  ['txns', 'Transações'],
  ['cats', 'Categorias'],
  ['tags', 'Tags'],
  ['plan', 'Planejamento'],
  ['tools', 'Ferramentas'],
  ['poup', 'Poupança'],
  ['movs', 'Movimentações'],
  ['rules', 'Regras'],
  ['review', 'Revisar'],
]

function Shell() {
  const d = useData()
  const toast = useToast()
  const { valuesHidden, toggleValues } = usePrivacy()
  const space = useSpace()
  const tab = space.tab
  const setTab = space.setTab
  const [selCat, setSelCat] = useState(null)
  const [txnPreset, setTxnPreset] = useState(null)
  const [edit, setEdit] = useState({ open: false, rows: [] })

  const openEdit = (rows) => setEdit({ open: true, rows })
  const closeEdit = () => setEdit((e) => ({ ...e, open: false }))
  const [reimburse, setReimburse] = useState({ open: false, rows: [], key: 0 })
  const openReimburse = (rows) =>
    setReimburse((current) => ({ open: true, rows, key: current.key + 1 }))
  const closeReimburse = () => setReimburse((current) => ({ ...current, open: false }))
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
  const openLedger = (origin) => {
    if (origin.date) { d.setMode('month'); d.setMonth(origin.date.slice(0, 7)) }
    setTxnPreset({ ids: [origin.ledger_id], idsLabel: 'Origem no investimento' })
    space.go('financas', 'txns')
  }
  const onRemoveQueue = async (i) => {
    try { await removeQueue(i); d.loadQueue(); toast('Removido da fila.', 'info') }
    catch (e) { toast(e.message, 'error') }
  }
  const onUpdateQueue = async (i, patch) => {
    try { await updateQueue(i, patch); await d.loadQueue()
      toast('Item da fila atualizado.', 'success') }
    catch (e) { toast(e.message, 'error') }
  }

  const investOnly = space.space === 'investimentos'
  if (d.error && !d.dash && !investOnly) {
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
  if ((!d.dash || !d.view) && !investOnly) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-3
        text-muted">
        <Spinner className="size-6" /> Carregando relatórios…
      </div>
    )
  }

  const { dash } = d
  const mdata = d.view || { transactions: [] }
  const month = d.periodKey
  const pickMonth = (m) => { if (m) { d.setMode('month'); d.setMonth(m) } }
  // ids que estão na Fila do Claude — pra marcar as linhas nas tabelas
  const queuedIds = new Set(d.queue.flatMap((q) => q.ids || []))
  const pend = dash
    ? (dash.pending ?? dash.needs_review + dash.uncategorized) + d.queue.length
    : 0

  return (
    <div className="relative z-[1] mx-auto w-full max-w-[1240px] px-4 pb-24 pt-7
      sm:px-6 lg:px-8 xl:max-w-[1560px] 2xl:max-w-[1800px]">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-[22px] font-bold
            tracking-tight">
            <span className="grid size-8 place-items-center rounded-xl
              bg-brand/10 text-brand ring-1 ring-brand/20">
              <Wallet className="size-[18px]" />
            </span>
            Finance Control
          </h1>
          <p className="mt-1 text-[12px] text-faint">
            {investOnly
              ? 'controle de investimentos'
              : dash
              ? `${dash.total_transactions} transações · atualizado ${
                new Date(dash.generated_at).toLocaleString('pt-BR')}`
              : 'controle financeiro'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {dash && !investOnly && d.queue.length > 0 && (
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
          {dash && !investOnly && <div className="flex gap-1 rounded-xl border border-border
            bg-surface2/70 p-1 text-[12.5px]">
            {['month', 'year'].map((mo) => (
              <button key={mo} onClick={() => d.setMode(mo)}
                className={`rounded-lg px-3.5 py-1.5 font-semibold transition ${
                  d.mode === mo
                    ? 'bg-brand text-white shadow-[0_1px_8px_#5b9dff55]'
                    : 'text-muted hover:text-text'}`}>
                {mo === 'month' ? 'Mês' : 'Ano'}
              </button>
            ))}
          </div>}
          {dash && !investOnly && (d.mode === 'month' ? (
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
          ))}
          <Button variant="ghost" onClick={toggleValues}
            className={valuesHidden ? 'bg-surface2 text-brand' : ''}
            aria-label="Modo de privacidade financeira"
            aria-pressed={valuesHidden}
            title={valuesHidden ? 'Mostrar valores' : 'Ocultar valores'}>
            {valuesHidden
              ? <EyeOff className="size-4" />
              : <Eye className="size-4" />}
          </Button>
          {!investOnly && d.pendingSaves > 0 && (
            <span className="flex items-center gap-1.5 text-[12px] text-muted"
              title="As alterações já estão na tela e estão sendo gravadas.">
              <RefreshCw className="size-3.5 animate-[spin_.8s_linear_infinite]" />
              salvando {d.pendingSaves}
            </span>
          )}
          {!investOnly && (
            <Button variant="ghost" onClick={d.refresh} disabled={d.busy}>
              <RefreshCw className={`size-4 ${d.busy
                ? 'animate-[spin_.8s_linear_infinite]' : ''}`} />
              Atualizar
            </Button>
          )}
        </div>
      </header>

      <nav className="mt-6 flex flex-wrap gap-1.5">
        {SPACE_TABS.map(([key, label, Icon]) => (
          <button key={key} onClick={() => space.go(key)}
            className={`flex items-center gap-2 rounded-xl border px-4 py-2
              text-[13.5px] font-semibold transition ${space.space === key
                ? 'border-brand/40 bg-brand/15 text-brand-soft'
                : 'border-border bg-surface2/60 text-muted hover:text-text'}`}>
            <Icon className="size-4" />
            {label}
            {key === 'financas' && pend > 0 && (
              <span className="rounded-full bg-amber/20 px-1.5 text-[11px] font-bold
                text-amber">{pend}</span>
            )}
          </button>
        ))}
      </nav>

      <nav className={`sticky top-0 z-20 -mx-5 mt-3 flex gap-1 border-b
        border-border px-5 pt-2 backdrop-blur-md ${investOnly
          ? 'flex-nowrap overflow-x-auto' : 'flex-wrap'}`}>
        {(space.space === 'investimentos' ? INVEST_TABS : TABS).map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)}
            className={`relative min-h-11 shrink-0 px-4 py-2.5 text-[14px] font-semibold
              transition ${tab === k
                ? 'text-text' : 'text-muted hover:text-text'}`}>
            {label}
            {k === 'review' && pend > 0 && (
              <span className="ml-2 rounded-full bg-amber/20 px-1.5 text-[11px]
                font-bold text-amber">{pend}</span>
            )}
            {tab === k && <span className="absolute inset-x-3 -bottom-px h-0.5
              rounded-full bg-brand" />}
          </button>
        ))}
      </nav>

      {d.error && (
        <div className="mt-4 rounded-xl border border-red/30 bg-red/10 px-4
          py-3 text-[13px] text-red">⚠ {d.error}</div>
      )}

      <main className="mt-6">
        {space.space === 'investimentos' && (
          <InvestSpace tab={tab} setTab={setTab} onError={d.setError}
            onOpenLedger={openLedger} />
        )}
        {space.space === 'financas' && tab === 'overview' && (
          <Overview dash={dash} month={month} mdata={mdata}
            setMonth={pickMonth} goCategory={goCategory}
            goReview={() => setTab('review')} queue={d.queue} />
        )}
        {space.space === 'financas' && tab === 'txns' && (
          <TransactionsTable txns={mdata.transactions || []} openEdit={openEdit}
            openReimburse={openReimburse}
            saveEdit={d.saveEdit} presetCat={txnPreset} queuedIds={queuedIds}
            treatments={dash.treatments} excludedCount={dash.excluded_count}
            title={`Transações — ${monthLabel(month)}`} />
        )}
        {space.space === 'financas' && tab === 'cats' && (
          <Categories dash={dash} mdata={mdata} month={month}
            selectedCat={selCat} setSelectedCat={setSelCat} goTxns={goTxns} />
        )}
        {space.space === 'financas' && tab === 'tags' && (
          <Tags dash={dash} mdata={mdata} period={month} />
        )}
        {space.space === 'financas' && tab === 'plan' && (d.mode === 'year' ? (
          <div className="rounded-2xl border border-border bg-surface/80 px-6
            py-12 text-center text-[14px] text-muted">
            O planejamento é mensal. Selecione <b className="text-text">Mês</b>{' '}
            no topo para editar tetos, metas e ver o ritmo.
          </div>
        ) : (
          <Planejamento dash={dash} mdata={mdata} month={month}
            onSaved={d.refresh} />
        ))}
        {space.space === 'financas' && tab === 'tools' && <Tools dash={dash} />}
        {space.space === 'financas' && tab === 'poup' && (
          <Poupanca dash={dash} mdata={mdata} month={month} />
        )}
        {space.space === 'financas' && tab === 'movs' && (
          <Movements dash={dash} mdata={mdata} month={month} />
        )}
        {space.space === 'financas' && tab === 'rules' && (
          <Rules dash={dash} mdata={mdata} period={month} />
        )}
        {space.space === 'financas' && tab === 'review' && (
          <Review dash={dash} queue={d.queue} queuedIds={queuedIds}
            onRemoveQueue={onRemoveQueue} onUpdateQueue={onUpdateQueue}
            openEdit={openEdit} saveEdit={d.saveEdit} />
        )}
      </main>

      {dash && (
        <DrillDrawer txns={mdata.transactions || []} openEdit={openEdit}
          openReimburse={openReimburse} saveEdit={d.saveEdit} queuedIds={queuedIds} treatments={dash.treatments} />
      )}

      {dash && edit.open && (
        <EditModal open={edit.open} onClose={closeEdit} txns={edit.rows}
          taxonomy={dash.taxonomy} allTxns={mdata.transactions || []}
          availableTags={dash.tags || []}
          knownSettlers={(dash.open_settlements || []).map((group) => group.name)}
          onSaved={onSaved} saveEdit={d.saveEdit} treatments={dash.treatments}
          destinations={dash.invest_destinations || []}
          simulator={dash.invest_simulator || []}
          destinationSubcategories={dash.invest_destination_subcategories} />
      )}

      {reimburse.open && (
        <ReimburseModal key={reimburse.key} open={reimburse.open}
          onClose={closeReimburse} txns={reimburse.rows} saveEdit={d.saveEdit} />
      )}
    </div>
  )
}

export default function App() {
  return (
    <ToastProvider>
      <PrivacyProvider>
        <DrillProvider>
          <Shell />
        </DrillProvider>
      </PrivacyProvider>
    </ToastProvider>
  )
}
