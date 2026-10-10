import { useEffect, useMemo, useState } from 'react'
import {
  useReactTable, getCoreRowModel, getSortedRowModel,
  getPaginationRowModel, flexRender,
} from '@tanstack/react-table'
import { Card } from './ui/primitives.jsx'
import { MultiSelect, inputCls } from './ui/MultiSelect.jsx'
import { Badge, Button } from './ui/primitives.jsx'
import {
  effectiveCategory, CategoryTag, SubcategoryTag,
} from '../lib/categories.jsx'
import { signedBrl, brl, fullDate, longDate, shortAccount } from '../lib/format.js'
import { SensitiveAmount } from './ui/SensitiveValue.jsx'
import { useDrill } from '../lib/useDrill.jsx'

const partAmounts = (t) => t.splits?.length
  ? t.splits.map((part) => part.amount) : [t.signed_amount]

// abater exige ao menos uma entrada e uma saída entre os selecionados
function canReimburse(selected) {
  const amounts = selected.flatMap(partAmounts)
  return amounts.some((amount) => amount > 0) && amounts.some((amount) => amount < 0)
}

// rótulos de categoria para FILTRO (split → partes; palpite Pluggy → "Sem categoria")
function effLabels(t) {
  const e = effectiveCategory(t)
  if (e.kind === 'split') return e.splits.map((s) => s.category || 'Outros')
  if (e.kind === 'uncat') return ['Sem categoria']
  return [e.label]
}
import {
  Search, Pencil, ChevronLeft, ChevronRight, X, ArrowUpDown,
  ArrowUp, ArrowDown, SlidersHorizontal, MessageSquare,
  PiggyBank, ArrowLeftRight, EyeOff, Wand2, Check, Tag as TagIcon, Link2, UserRound,
  Landmark, CircleAlert,
} from 'lucide-react'
import { STATUS_LABEL } from '../lib/destinations.js'

function InvestBadge({ transaction, onOpen }) {
  const info = transaction.invest
  if (!info) return null
  const links = info.links || []
  const detail = links.map((link) => `${link.name}: ${brl(link.amount)}`).join('\n')
  if (info.status === 'linked' || info.status === 'info') {
    const label = links.length === 1 ? links[0].name : `${links.length} destinos`
    return (
      <button type="button" onClick={onOpen}
        title={`${STATUS_LABEL[info.status]}\n${detail}\nClique para editar.`}
        className="inline-flex max-w-[190px] items-center gap-1 rounded-full border
          border-violet/40 bg-violet/10 px-1.5 py-0.5 text-[11px] font-semibold
          text-violet hover:bg-violet/20">
        <Landmark className="size-3 shrink-0" />
        <span className="truncate">→ {label}</span>
      </button>
    )
  }
  const text = info.status === 'missing' ? 'sem destino'
    : info.status === 'partial' ? `faltam ${brl(info.needed - info.linked)}`
      : `destino a mais ${brl(info.linked - info.needed)}`
  return (
    <button type="button" onClick={onOpen}
      title={`${STATUS_LABEL[info.status]} no investimento${detail ? `\n${detail}` : ''}`
        + '\nClique para definir.'}
      className="inline-flex items-center gap-1 rounded-full border border-amber/40
        bg-amber/10 px-1.5 py-0.5 text-[11px] font-semibold text-amber
        hover:bg-amber/20">
      <CircleAlert className="size-3" />{text}
    </button>
  )
}

function SettleChips({ transaction }) {
  const names = [...new Set([transaction.settle_with,
    ...(transaction.splits || []).map((part) => part.settle_with)].filter(Boolean))]
  return names.map((name) => (
    <span key={name} title={`A acertar com ${name}`}
      className="inline-flex max-w-[140px] cursor-help items-center gap-1 rounded-full
        border border-border bg-surface2 px-1.5 py-0.5 text-[11px] font-medium
        text-muted">
      <UserRound className="size-3 shrink-0" />
      <span className="truncate">{name}</span>
    </span>
  ))
}

function ReimbursedBadge({ transaction, onOpen }) {
  const info = transaction.reimbursed
  if (!info?.links?.length) return null
  const total = Math.abs(transaction.signed_amount)
  const full = !transaction.splits?.length && info.amount >= total - 0.005
  const verb = (link) => link.side === 'credit' ? 'Abate' : 'Abatido por'
  const title = info.links.map((link) =>
    `${verb(link)} ${link.other_description || link.other_id}`
    + `${link.other_date ? ` (${fullDate(link.other_date)})` : ''}: ${brl(link.amount)}`)
    .join('\n')
  return (
    <button type="button" onClick={onOpen} title={`${title}\nClique para ver o grupo.`}
      className="inline-flex items-center gap-1 rounded-full border border-green/40
        bg-green/10 px-1.5 py-0.5 text-[11px] font-semibold text-green
        hover:bg-green/20">
      <Link2 className="size-3" />
      {full ? 'abatido' : `abatido ${brl(info.amount)}${
        transaction.splits?.length ? '' : ` de ${brl(total)}`}`}
    </button>
  )
}

const EMPTY = { q: '', cats: [], tags: [], ids: [], idsLabel: '', accs: [], flow: '',
  rev: false,
  d0: '', d1: '', a0: '', a1: '', sub: '', rule: '', queued: false, excl: false,
  hiddenCats: [], hiddenSubs: [] }

export function TransactionsTable({ txns, openEdit, openReimburse, saveEdit, title,
  presetCat, initialFilter, compact, pageSize = 25, queuedIds, treatments,
  excludedCount = 0, page = false }) {
  const drill = useDrill()
  const qids = queuedIds || new Set()
  const isQueued = (id) => qids.has && qids.has(id)
  const treatOf = (cat) => (treatments || {})[cat] || 'fluxo'
  // mostra o filtro se há rasurados nesta view OU em qualquer lugar do app
  const viewExcl = useMemo(() => txns.filter((t) => t.excluded).length, [txns])
  const showExclToggle = viewExcl > 0 || excludedCount > 0
  const [f, setF] = useState(EMPTY)
  const [sorting, setSorting] = useState([{ id: 'date', desc: true }])
  const [sel, setSel] = useState({})
  const [showFilters, setShowFilters] = useState(!compact)
  const [showExtra, setShowExtra] = useState(false)
  const set = (k, v) => setF((s) => ({ ...s, [k]: v }))

  useEffect(() => {
    if (presetCat) setF(typeof presetCat === 'string'
      ? { ...EMPTY, cats: [presetCat] } : { ...EMPTY, ...presetCat })
  }, [presetCat])

  const initKey = JSON.stringify(initialFilter || null)
  useEffect(() => {
    if (initialFilter) setF({ ...EMPTY, ...initialFilter })
  }, [initKey])  // eslint-disable-line react-hooks/exhaustive-deps

  const catOpts = useMemo(
    () => [...new Set(txns.flatMap(effLabels))].sort(), [txns])
  const accOpts = useMemo(
    () => [...new Set(txns.map((t) => t.account_name))].sort(), [txns])
  const tagOpts = useMemo(
    () => [...new Set(txns.flatMap((transaction) => transaction.tags || []))].sort(),
    [txns])
  // opções de subcategoria: restringe às categorias selecionadas e tira as ocultas
  const subOpts = useMemo(() => {
    const inScope = txns.filter((t) => {
      const tcats = effLabels(t)
      if (f.cats.length && !tcats.some((c) => f.cats.includes(c))) return false
      if (f.hiddenCats.length && tcats.every((c) => f.hiddenCats.includes(c))) return false
      return true
    })
    const subs = inScope.flatMap((t) =>
      t.splits?.length ? t.splits.map((s) => s.subcategory) : [t.subcategory])
    return [...new Set(subs.filter(Boolean))].sort()
  }, [txns, f.cats, f.hiddenCats])

  const rows = useMemo(() => {
    const q = f.q.trim().toLowerCase()
    const a0 = f.a0 === '' ? null : +f.a0
    const a1 = f.a1 === '' ? null : +f.a1
    return txns.filter((t) => {
      if (t.excluded && !f.excl) return false
      const tcats = effLabels(t)
      const tsubs = t.splits?.length
        ? t.splits.map((s) => s.subcategory || '')
        : [t.subcategory || '']
      if (f.cats.length && !tcats.some((c) => f.cats.includes(c))) return false
      if (f.hiddenCats.length && tcats.every((c) => f.hiddenCats.includes(c))) return false
      if (f.sub && !tsubs.includes(f.sub)) return false
      if (f.rule && t.rule_id !== f.rule) return false
      if (f.ids.length && !f.ids.includes(t.id)) return false
      if (f.hiddenSubs.length && tsubs.every((s) => f.hiddenSubs.includes(s))) return false
      if (f.tags.length && !f.tags.every(
        (tag) => (t.tags || []).includes(tag))) return false
      if (f.accs.length && !f.accs.includes(t.account_name)) return false
      if (f.flow === 'in' && t.signed_amount <= 0) return false
      if (f.flow === 'out' && t.signed_amount >= 0) return false
      if (f.rev && !t.needs_review) return false
      if (f.queued && !isQueued(t.id)) return false
      if (f.d0 && t.date < f.d0) return false
      if (f.d1 && t.date > f.d1) return false
      const abs = Math.abs(t.signed_amount)
      if (a0 != null && abs < a0) return false
      if (a1 != null && abs > a1) return false
      if (q) {
        const hay = (`${t.description} ${t.counterparty || ''} ${t.category || ''} `
          + `${t.subcategory || ''} ${(t.tags || []).join(' ')}`).toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [txns, f, queuedIds])  // eslint-disable-line react-hooks/exhaustive-deps

  // excluídos ("rasurados") não entram nos totais mesmo quando visíveis
  const totIn = rows.reduce((a, t) =>
    !t.excluded && t.signed_amount > 0 ? a + t.signed_amount : a, 0)
  const totOut = rows.reduce((a, t) =>
    !t.excluded && t.signed_amount < 0 ? a + t.signed_amount : a, 0)

  const columns = useMemo(() => [
    {
      id: 'sel',
      header: ({ table }) => (
        <input type="checkbox" checked={table.getIsAllRowsSelected()}
          onChange={table.getToggleAllRowsSelectedHandler()} />
      ),
      cell: ({ row }) => (
        <input type="checkbox" checked={row.getIsSelected()}
          onChange={row.getToggleSelectedHandler()} />
      ),
      enableSorting: false,
    },
    { accessorKey: 'date', header: 'Data',
      // desempate por hora: dentro do mesmo dia, a ordem segue a mesma direção
      // da data (desc = mais tarde no topo, como no resto da lista)
      sortingFn: (a, b) => {
        const ka = `${a.original.date} ${a.original.time || '00:00'}`
        const kb = `${b.original.date} ${b.original.time || '00:00'}`
        return ka < kb ? -1 : ka > kb ? 1 : 0
      },
      cell: (c) => <span className="tnum text-muted">{fullDate(c.getValue())}</span> },
    {
      accessorKey: 'description', header: 'Descrição', enableSorting: false,
      cell: ({ row }) => {
        const tags = row.original.tags || []
        return (
          <div className="min-w-[180px]">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1
              font-semibold text-strong">
              <span className="break-words">{row.original.description}</span>
              <span className="inline-flex shrink-0 items-center gap-1.5">
                {row.original.time && (
                  <span className="tnum text-[12px] font-normal
                    text-subtle">{row.original.time}</span>
                )}
                {tags.length > 0 && (
                  <button type="button" onClick={() => set('tags', [tags[0]])}
                    title={`Tags: ${tags.join(', ')}. Clique para filtrar.`}
                    className="inline-flex max-w-[160px] items-center gap-1
                      rounded-full border border-brand/30 bg-brand/10 px-1.5
                      py-px text-[11px] font-medium text-brand
                      hover:bg-brand/20">
                    <TagIcon className="size-3 shrink-0" />
                    <span className="truncate">{tags[0]}</span>
                    {tags.length > 1 && (
                      <span className="tnum shrink-0 text-brand/70">
                        +{tags.length - 1}</span>
                    )}
                  </button>
                )}
              </span>
            </div>
            {row.original.note && (
              <div className="mt-0.5 line-clamp-2 text-[13.5px] text-secondary"
                title={row.original.note}>{row.original.note}</div>
            )}
            {row.original.counterparty && (
              <div className="mt-0.5 text-[12.5px] text-subtle">
                {row.original.counterparty}</div>
            )}
          </div>
        )
      },
    },
    {
      accessorKey: 'category', header: 'Categoria', enableSorting: false,
      cell: ({ row }) => {
        const t = row.original
        const e = effectiveCategory(t)
        const pick = (c) => set('cats', [c])   // clicar filtra a tabela
        const qb = isQueued(t.id) ? (
          <span title="Enviado pra Fila do Claude — aguardando"
            className="inline-flex items-center gap-1 rounded-full border
              border-blue/40 bg-blue/15 px-2 py-0.5 text-[11px] font-semibold
              text-blue cursor-help">
            <MessageSquare className="size-3" />fila
          </span>
        ) : null
        // badge do tratamento (poupança/movimento não são fluxo de gastos)
        const tr = e.kind === 'split' ? 'fluxo' : treatOf(e.label)
        const tb = tr === 'poupança' ? (
          <span title="Poupança — não é gasto"
            className="inline-flex items-center rounded-full border
              border-violet/40 bg-violet/15 px-1.5 py-0.5 text-violet cursor-help">
            <PiggyBank className="size-3" />
          </span>
        ) : tr === 'movimento' ? (
          <span title="Movimento — auditoria, fora do fluxo"
            className="inline-flex items-center rounded-full border border-border
              bg-surface2 px-1.5 py-0.5 text-faint cursor-help">
            <ArrowLeftRight className="size-3" />
          </span>
        ) : null
        // rasurado: fora de todos os relatórios
        const xb = t.excluded ? (
          <span title="Rasurado — fora de todos os relatórios"
            className="inline-flex items-center gap-1 rounded-full border
              border-amber/40 bg-amber/10 px-1.5 py-0.5 text-[11px] font-semibold
              text-amber cursor-help no-underline">
            <EyeOff className="size-3" />rasurado
          </span>
        ) : null
        // palpite do mapa da Pluggy, ainda não confirmado por ninguém
        const pluggyGuess = t.category_source === 'pluggy-map' && !t.reviewed
        const sw = <SettleChips transaction={t} />
        const ib = <InvestBadge transaction={t} onOpen={() => openEdit([t])} />
        const rb = <ReimbursedBadge transaction={t} onOpen={() => drill?.drill(
          `Abatimento: ${t.description}`,
          { ids: [t.id, ...t.reimbursed.links.map((link) => link.other_id)] })} />
        const pm = pluggyGuess ? (
          <span title="Categoria sugerida pelo mapa da Pluggy — ainda não confirmada"
            className="inline-flex items-center gap-1 rounded-full border
              border-blue/40 bg-blue/10 px-1.5 py-0.5 text-[11px] font-semibold
              text-blue cursor-help">
            <Wand2 className="size-3" />Pluggy
          </span>
        ) : null
        if (e.kind === 'split') {
          return (
            <div className="flex flex-wrap items-center gap-1.5">
              <Badge tone="violet">dividido</Badge>
              {e.splits.map((s, k) => (
                <CategoryTag key={k} size="xs" category={s.category}
                  subcategory={s.subcategory}
                  title={`${s.category}${s.subcategory ? '/' + s.subcategory : ''} ${signedBrl(s.amount)}`}
                  onClick={() => pick(s.category)} />
              ))}
              {qb}{xb}{rb}{sw}{ib}
            </div>
          )
        }
        if (e.kind === 'uncat') {
          return (
            <span className="flex flex-wrap items-center gap-2">
              <CategoryTag uncategorized hint={e.hint}
                onClick={() => pick('Sem categoria')} />
              {t.needs_review && <Badge tone="amber">revisar</Badge>}
              {tb}{qb}{xb}{pm}{rb}{sw}{ib}
            </span>
          )
        }
        return (
          <span className="flex flex-wrap items-center gap-2">
            <CategoryTag category={e.label} onClick={() => pick(e.label)} />
            {t.needs_review && <Badge tone="amber">revisar</Badge>}
            {tb}{qb}{xb}{pm}{rb}{sw}{ib}
          </span>
        )
      },
    },
    {
      accessorKey: 'subcategory', header: 'Subcategoria', enableSorting: false,
      cell: ({ row }) => {
        const t = row.original
        if (t.splits?.length) return <span className="text-subtle">—</span>
        const e = effectiveCategory(t)
        if (e.kind !== 'cat' || !e.subcategory) {
          return <span className="text-subtle">—</span>
        }
        return <SubcategoryTag category={e.label} subcategory={e.subcategory}
          onClick={() => set('sub', e.subcategory)}
          title="Filtrar por esta subcategoria" />
      },
    },
    { accessorKey: 'account_name', header: 'Conta', enableSorting: false,
      cell: (c) => <span className="whitespace-nowrap text-[13.5px] text-secondary"
        title={c.getValue()}>{shortAccount(c.getValue())}</span> },
    {
      accessorKey: 'signed_amount', header: 'Valor', meta: { align: 'right' },
      cell: (c) => (
        <span className={`tnum whitespace-nowrap text-[15px] font-semibold ${
          c.getValue() >= 0 ? 'text-green' : 'text-red'}`}>
          <SensitiveAmount>{signedBrl(c.getValue())}</SensitiveAmount></span>
      ),
    },
    {
      id: 'act', header: '', enableSorting: false,
      cell: ({ row }) => {
        const t = row.original
        const canConfirm = saveEdit
          && t.category_source === 'pluggy-map' && !t.reviewed
        return (
          <div className="flex items-center justify-end gap-1 transition
            md:opacity-0 md:group-hover:opacity-100 md:focus-within:opacity-100">
            {canConfirm && (
              <button onClick={() => saveEdit({ mode: 'value', ids: [t.id],
                category: t.category, subcategory: t.subcategory })}
                className="rounded-lg p-1.5 text-secondary hover:bg-surface2
                  hover:text-green" title="Confirmar o palpite da Pluggy">
                <Check className="size-3.5" />
              </button>
            )}
            <button onClick={() => openEdit([t])}
              className="rounded-lg p-1.5 text-secondary hover:bg-surface2
                hover:text-strong" title="Editar">
              <Pencil className="size-3.5" />
            </button>
          </div>
        )
      },
    },
  ], [openEdit, saveEdit, queuedIds, treatments, drill])  // eslint-disable-line react-hooks/exhaustive-deps

  // agrupa por dia quando ordenado por data (padrão) — some a coluna Data
  const grouped = (sorting[0]?.id || 'date') === 'date'
  const table = useReactTable({
    data: rows, columns,
    state: { sorting, rowSelection: sel,
      columnVisibility: { date: !grouped } },
    getRowId: (r) => r.id,
    onSortingChange: setSorting, onRowSelectionChange: setSel,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageSize } },
  })

  const selected = table.getSelectedRowModel().rows.map((r) => r.original)
  const active = JSON.stringify(f) !== JSON.stringify(EMPTY)
  const extraActive = [f.hiddenSubs.length > 0, f.tags.length > 0, !!f.d0, !!f.d1,
    f.a0 !== '', f.a1 !== '', f.rev, f.queued, f.excl, !!f.sub].filter(Boolean).length
  const pageRows = table.getRowModel().rows
  const colCount = table.getVisibleLeafColumns().length
  const dayAgg = {}
  if (grouped) {
    for (const r of pageRows) {
      const a = dayAgg[r.original.date]
        || (dayAgg[r.original.date] = { count: 0, net: 0 })
      a.count += 1
      a.net += r.original.signed_amount
    }
  }

  const pager = rows.length > 0 ? (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t
      border-border px-5 py-3 text-[13.5px] text-secondary">
      <label className="flex items-center gap-2">
        Por página
        <select value={table.getState().pagination.pageSize}
          onChange={(e) => table.setPageSize(+e.target.value)}
          className={inputCls('py-1')}>
          {[25, 50, 100, 200].map((n) => <option key={n}>{n}</option>)}
        </select>
      </label>
      {table.getPageCount() > 1 && (
        <div className="flex items-center gap-3">
          <span>
            Página {table.getState().pagination.pageIndex + 1} de{' '}
            {table.getPageCount()}
          </span>
          <Button variant="ghost" onClick={() => table.previousPage()}
            disabled={!table.getCanPreviousPage()} aria-label="Página anterior">
            <ChevronLeft className="size-4" />
          </Button>
          <Button variant="ghost" onClick={() => table.nextPage()}
            disabled={!table.getCanNextPage()} aria-label="Próxima página">
            <ChevronRight className="size-4" />
          </Button>
        </div>
      )}
    </div>
  ) : null

  const chip = (label, onClear, tone = 'brand', Icon = null) => (
    <button type="button" onClick={onClear} title="Remover filtro"
      className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1
        text-[12.5px] font-medium ${tone === 'green'
          ? 'border-green/40 bg-green/10 text-green hover:bg-green/20'
          : 'border-brand/30 bg-brand/10 text-brand-soft hover:bg-brand/20'}`}>
      {Icon && <Icon className="size-3" />}{label}<X className="size-3" />
    </button>
  )

  const stat = (label, value, tone) => (
    <div>
      <p className="text-[13px] text-secondary">{label}</p>
      <p className={`tnum mt-0.5 text-[18px] font-bold ${tone}`}>{value}</p>
    </div>
  )

  const toolbar = (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          {title && (page
            ? <h2 className="text-[24px] font-bold tracking-[-0.03em] text-strong">
                {title}</h2>
            : <h3 className="text-[19px] font-bold tracking-[-0.02em] text-strong">
                {title}</h3>)}
          {f.rule && chip(`Regra ${f.rule}`, () => set('rule', ''))}
          {f.ids.length > 0 && chip(f.idsLabel || 'Grupo abatido',
            () => set('ids', []), 'green', Link2)}
          {f.sub && chip(f.sub, () => set('sub', ''))}
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2
              text-subtle" />
            <input value={f.q} onChange={(e) => set('q', e.target.value)}
              placeholder="Buscar…" aria-label="Buscar lançamentos"
              className={inputCls('w-56 pl-9')} />
          </div>
          {compact && (
            <Button variant={showFilters ? 'default' : 'ghost'}
              onClick={() => setShowFilters((s) => !s)} aria-expanded={showFilters}>
              <SlidersHorizontal className="size-4" /> Filtros
            </Button>
          )}
        </div>
      </div>

      {showFilters && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <MultiSelect label="Categoria" options={catOpts}
            value={catOpts.filter((c) => !f.hiddenCats.includes(c))}
            count={f.hiddenCats.length}
            onChange={(visible) =>
              set('hiddenCats', catOpts.filter((c) => !visible.includes(c)))}
            actions={[
              { label: 'Marcar Todas', onClick: () => set('hiddenCats', []) },
              { label: 'Desmarcar Todas', onClick: () => set('hiddenCats', catOpts) },
            ]} />
          <MultiSelect label="Conta" options={accOpts} value={f.accs}
            onChange={(v) => set('accs', v)} />
          <select value={f.flow} onChange={(e) => set('flow', e.target.value)}
            aria-label="Entradas e saídas" className={inputCls()}>
            <option value="">Entradas e saídas</option>
            <option value="in">Só entradas</option>
            <option value="out">Só saídas</option>
          </select>
          <Button variant={showExtra ? 'default' : 'ghost'}
            onClick={() => setShowExtra((s) => !s)} aria-expanded={showExtra}>
            <SlidersHorizontal className="size-4" /> Mais filtros
            {extraActive > 0 && (
              <span className="rounded-full bg-brand/25 px-1.5 text-[11px] font-bold
                text-brand-soft">{extraActive}</span>
            )}
          </Button>
          {active && (
            <Button variant="ghost" onClick={() => setF(EMPTY)}>
              <X className="size-3.5" /> Limpar
            </Button>
          )}
        </div>
      )}

      {showFilters && showExtra && (
        <div className="mt-2 flex flex-wrap items-center gap-2 rounded-xl border
          border-border bg-surface2/40 p-2">
          <MultiSelect label="Subcategoria" options={subOpts}
            value={subOpts.filter((s) => !f.hiddenSubs.includes(s))}
            count={f.hiddenSubs.length}
            onChange={(visible) =>
              set('hiddenSubs', subOpts.filter((s) => !visible.includes(s)))}
            actions={[
              { label: 'Marcar Todas', onClick: () => set('hiddenSubs', []) },
              { label: 'Desmarcar Todas', onClick: () => set('hiddenSubs', subOpts) },
            ]} />
          <MultiSelect label="Tags" options={tagOpts} value={f.tags}
            onChange={(value) => set('tags', value)} />
          <div className="flex items-center gap-1 text-[13px] text-secondary">
            <input type="date" value={f.d0} onChange={(e) => set('d0', e.target.value)}
              aria-label="Data inicial" className={inputCls('w-[140px]')} />
            <span>até</span>
            <input type="date" value={f.d1} onChange={(e) => set('d1', e.target.value)}
              aria-label="Data final" className={inputCls('w-[140px]')} />
          </div>
          <div className="flex items-center gap-1 text-[13px] text-secondary">
            <input type="number" placeholder="R$ mín" value={f.a0}
              onChange={(e) => set('a0', e.target.value)}
              aria-label="Valor mínimo" className={inputCls('w-24')} />
            <span>até</span>
            <input type="number" placeholder="R$ máx" value={f.a1}
              onChange={(e) => set('a1', e.target.value)}
              aria-label="Valor máximo" className={inputCls('w-24')} />
          </div>
          <label className="flex items-center gap-2 rounded-xl border
            border-border bg-surface2 px-3 py-2 text-[13px] text-secondary">
            <input type="checkbox" checked={f.rev}
              onChange={(e) => set('rev', e.target.checked)} />
            Só a revisar
          </label>
          {qids.size > 0 && (
            <label className="flex items-center gap-2 rounded-xl border
              border-blue/40 bg-blue/10 px-3 py-2 text-[13px] text-blue">
              <input type="checkbox" checked={f.queued}
                onChange={(e) => set('queued', e.target.checked)} />
              Só fila do Claude
            </label>
          )}
          {showExclToggle && (
            <label className="flex items-center gap-2 rounded-xl border
              border-amber/40 bg-amber/10 px-3 py-2 text-[13px] text-amber">
              <input type="checkbox" checked={f.excl}
                onChange={(e) => set('excl', e.target.checked)} />
              <EyeOff className="size-3.5" /> Mostrar rasurados
              {viewExcl > 0
                ? <span className="tnum font-semibold">({viewExcl})</span>
                : <span className="text-amber/70">(nenhum neste mês)</span>}
            </label>
          )}
        </div>
      )}
    </>
  )

  const summary = (
    <div className="flex flex-wrap items-end gap-x-10 gap-y-3">
      {stat('Lançamentos', rows.length === txns.length
        ? rows.length : `${rows.length} de ${txns.length}`, 'text-strong')}
      {stat('Entradas', <SensitiveAmount>{brl(totIn)}</SensitiveAmount>, 'text-green')}
      {stat('Saídas', <SensitiveAmount>{brl(Math.abs(totOut))}</SensitiveAmount>,
        'text-red')}
      {stat('Líquido', <SensitiveAmount>{signedBrl(totIn + totOut)}</SensitiveAmount>,
        totIn + totOut >= 0 ? 'text-green' : 'text-red')}
    </div>
  )

  const body = (
    <>
      {selected.length > 0 && (
        <div className="flex items-center justify-between gap-3 bg-brand/[0.08]
          px-5 py-2.5 text-[14px]">
          <span className="font-semibold text-brand-soft">
            {selected.length} selecionado(s)</span>
          <div className="flex gap-2">
            <Button variant="primary" onClick={() => openEdit(selected)}>
              <Pencil className="size-3.5" /> Editar em massa
            </Button>
            {openReimburse && canReimburse(selected) && (
              <Button onClick={() => openReimburse(selected)}>
                <Link2 className="size-3.5" /> Abater
              </Button>
            )}
            <Button variant="ghost" onClick={() => setSel({})}>Limpar</Button>
          </div>
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-[14px]">
          <thead className="bg-table-head">
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id} className="border-b border-white/15 text-left">
                {hg.headers.map((h) => {
                  const sortable = h.column.getCanSort()
                  const dir = h.column.getIsSorted()
                  const right = h.column.columnDef.meta?.align === 'right'
                  return (
                    <th key={h.id}
                      onClick={sortable ? h.column.getToggleSortingHandler() : undefined}
                      className={`whitespace-nowrap px-5 py-3.5 text-[13.5px] font-bold
                        text-strong ${right ? 'text-right' : ''}
                        ${sortable ? 'cursor-pointer select-none hover:text-brand-soft' : ''}`}>
                      <span className={`inline-flex items-center gap-1 ${
                        right ? 'flex-row-reverse' : ''}`}>
                        {flexRender(h.column.columnDef.header, h.getContext())}
                        {sortable && (dir === 'asc' ? <ArrowUp className="size-3.5" />
                          : dir === 'desc' ? <ArrowDown className="size-3.5" />
                            : <ArrowUpDown className="size-3.5 opacity-40" />)}
                      </span>
                    </th>
                  )
                })}
              </tr>
            ))}
          </thead>
          <tbody>
            {(() => {
              let prevDay = null
              const out = []
              for (const r of pageRows) {
                const day = r.original.date
                if (grouped && day !== prevDay) {
                  prevDay = day
                  const ag = dayAgg[day] || { count: 0, net: 0 }
                  out.push(
                    <tr key={`h-${day}`}
                      className="border-b border-border bg-surface2/50">
                      <td colSpan={colCount - 2} className="px-5 py-2.5">
                        <span className="flex items-center gap-2.5">
                          <span className="text-[14px] font-bold text-strong">
                            {longDate(day)}</span>
                          <span className="rounded-full bg-white/[0.06] px-2 py-0.5
                            text-[12px] font-semibold text-secondary">
                            {ag.count} {ag.count === 1 ? 'lançamento' : 'lançamentos'}
                          </span>
                        </span>
                      </td>
                      <td className={`tnum whitespace-nowrap px-5 py-2.5 text-right
                        text-[14px] font-semibold ${ag.net >= 0 ? 'text-green' : 'text-red'}`}>
                        <SensitiveAmount>{signedBrl(ag.net)}</SensitiveAmount>
                      </td>
                      <td />
                    </tr>,
                  )
                }
                out.push(
                  <tr key={r.id}
                    className={`group border-b border-border/60 hover:bg-white/[0.03]
                      ${r.original.excluded
                        ? 'opacity-45 [&_td]:line-through'
                        : r.getIsSelected() ? 'bg-brand/[0.07]'
                          : isQueued(r.original.id)
                            ? 'bg-blue/[0.05] border-l-2 border-l-blue/50' : ''}`}>
                    {r.getVisibleCells().map((c) => (
                      <td key={c.id} className={`px-5 py-3.5 align-top ${
                        c.column.columnDef.meta?.align === 'right' ? 'text-right' : ''}`}>
                        {flexRender(c.column.columnDef.cell, c.getContext())}
                      </td>
                    ))}
                  </tr>,
                )
              }
              return out
            })()}
            {rows.length === 0 && (
              <tr><td colSpan={colCount} className="py-14 text-center text-[14px]
                text-subtle">Nenhum lançamento com esses filtros.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {pager}
    </>
  )

  if (page) {
    return (
      <div className="flex flex-col">
        <div className="pb-5">
          {toolbar}
          <div className="mt-5">{summary}</div>
        </div>
        <div className="overflow-hidden rounded-xl">{body}</div>
      </div>
    )
  }

  return (
    <Card className="overflow-hidden">
      <div className="px-5 pt-5">{toolbar}</div>
      <div className="mt-4 border-y border-border bg-surface2/40 px-5 py-3">
        {summary}
      </div>
      {body}
    </Card>
  )
}
