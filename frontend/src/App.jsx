import { useEffect, useState } from 'react'
import { useData } from './lib/useData.js'
import { removeQueue, updateQueue } from './lib/api.js'
import { timeAgo } from './lib/format.js'
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
import { Eye, EyeOff, RefreshCw, Menu, MessageSquare } from 'lucide-react'
import { InvestSpace } from './components/invest/InvestSpace.jsx'
import { PeriodNav } from './components/PeriodNav.jsx'
import { Sidebar, NavDrawer, BottomBar } from './components/Navigation.jsx'
import { useSpace } from './lib/useSpace.js'
import { NAV, findItem } from './lib/nav.js'

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
  const [now, setNow] = useState(() => Date.now())
  const [drawer, setDrawer] = useState(false)
  // trocar de tela volta ao topo (o menu fica fixo; o conteúdo é que rola)
  useEffect(() => { window.scrollTo(0, 0) }, [tab, space.space])
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60000)
    return () => clearInterval(timer)
  }, [])

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

  const badges = { financas: pend, pending: pend }
  const current = findItem(space.space, tab)
  const go = (s, t) => space.go(s, t)

  return (
    <div className="relative z-[1] flex min-h-dvh">
      <Sidebar space={space.space} tab={tab} onGo={go} badges={badges} />
      <NavDrawer open={drawer} onOpenChange={setDrawer} space={space.space} tab={tab}
        onGo={go} badges={badges} />
      <div className="mx-auto w-full min-w-0 max-w-[1240px] flex-1 px-4 pb-28 pt-3
        sm:px-6 sm:pt-6 lg:px-8 lg:pb-24 xl:max-w-[1560px] 2xl:max-w-[1800px]">
      <header className="flex flex-wrap items-center justify-between gap-x-2 gap-y-3
        sm:gap-4">
        <div className="flex min-w-0 items-center gap-1">
          <button onClick={() => setDrawer(true)} aria-label="Abrir menu"
            className="-ml-2 grid size-10 shrink-0 place-items-center rounded-xl text-muted
              hover:bg-surface2 hover:text-text lg:hidden">
            <Menu className="size-5" />
          </button>
          <div className="min-w-0">
            <p className="truncate text-[11.5px] font-medium uppercase tracking-wider
              text-faint">{NAV[space.space].label}</p>
            <h1 className="truncate text-[19px] font-bold tracking-tight sm:text-[22px]">
              {current?.label}</h1>
          </div>
        </div>
        {/* telas com o histórico inteiro (periodless no nav.js) não têm seletor de mês */}
        {dash && !investOnly && !current?.periodless && (
          <div className="order-last w-full sm:order-none sm:ml-auto sm:w-auto">
            <PeriodNav mode={d.mode} setMode={d.setMode}
              months={dash.months.map((m) => m.month)} month={d.month}
              setMonth={d.setMonth} years={d.years} year={d.year} setYear={d.setYear} />
          </div>
        )}
        <div className="flex items-center gap-1 sm:gap-2">
          {dash && !investOnly && d.queue.length > 0 && (
            <button onClick={() => setTab('review')}
              className="flex items-center gap-2 rounded-xl border border-blue/40
                bg-blue/10 px-3 py-2 text-[13px] text-blue hover:bg-blue/20"
              title="Itens que você mandou pro Claude">
              <MessageSquare className="size-4" />
              <span className="hidden sm:inline">Fila do Claude</span>
              <span className="rounded-full bg-blue/25 px-1.5 text-[11px]
                font-bold">{d.queue.length}</span>
            </button>
          )}
          <Button variant="ghost" onClick={toggleValues}
            className={`max-sm:size-10 max-sm:justify-center max-sm:p-0 ${
              valuesHidden ? 'bg-surface2 text-brand' : ''}`}
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
            <div className="flex flex-col items-end">
              <Button variant="ghost" onClick={d.refresh} disabled={d.busy}
                aria-label="Atualizar"
                title={dash ? `Atualizado ${timeAgo(dash.generated_at, now)}` : 'Atualizar'}
                className="max-sm:size-10 max-sm:justify-center max-sm:p-0">
                <RefreshCw className={`size-4 ${d.busy
                  ? 'animate-[spin_.8s_linear_infinite]' : ''}`} />
                <span className="hidden sm:inline">Atualizar</span>
              </Button>
              {dash && (
                <span className="-mt-0.5 hidden pr-3.5 text-[12px] text-subtle sm:inline"
                  title={new Date(dash.generated_at).toLocaleString('pt-BR')}>
                  Atualizado {timeAgo(dash.generated_at, now)}
                </span>
              )}
            </div>
          )}
        </div>
      </header>

      {d.error && (
        <div className="mt-4 rounded-xl border border-red/30 bg-red/10 px-4
          py-3 text-[13px] text-red">⚠ {d.error}</div>
      )}

      <main className="mt-4 sm:mt-5">
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
            title="Transações" page pageSize={100} />
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
      </div>

      <BottomBar space={space.space} tab={tab} onGo={go} badges={badges}
        onMore={() => setDrawer(true)} />

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
