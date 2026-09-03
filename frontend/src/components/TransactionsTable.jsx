import { useEffect, useMemo, useState } from 'react'
import {
  useReactTable, getCoreRowModel, getSortedRowModel,
  getPaginationRowModel, flexRender,
} from '@tanstack/react-table'
import { Card } from './ui/primitives.jsx'
import { MultiSelect, inputCls } from './ui/MultiSelect.jsx'
import { Badge, Button } from './ui/primitives.jsx'
import { effectiveCategory, CategoryTag } from '../lib/categories.jsx'
import { signedBrl, brl, fullDate, longDate } from '../lib/format.js'

// rótulos de categoria para FILTRO (split → partes; palpite Pluggy → "Sem categoria")
function effLabels(t) {
  const e = effectiveCategory(t)
  if (e.kind === 'split') return e.splits.map((s) => s.category || 'Outros')
  if (e.kind === 'uncat') return ['Sem categoria']
  return [e.label]
}
import {
  Search, Pencil, ChevronLeft, ChevronRight, X, ArrowUpDown,
  ArrowUp, ArrowDown, SlidersHorizontal, StickyNote, MessageSquare,
  PiggyBank, ArrowLeftRight, EyeOff,
} from 'lucide-react'

const EMPTY = { q: '', cats: [], accs: [], flow: '', rev: false,
  d0: '', d1: '', a0: '', a1: '', sub: '', queued: false, excl: false }

export function TransactionsTable({ txns, openEdit, title, presetCat,
  initialFilter, compact, pageSize = 25, queuedIds, treatments,
  excludedCount = 0 }) {
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
  const set = (k, v) => setF((s) => ({ ...s, [k]: v }))

  useEffect(() => {
    if (presetCat) setF({ ...EMPTY, cats: [presetCat] })
  }, [presetCat])

  const initKey = JSON.stringify(initialFilter || null)
  useEffect(() => {
    if (initialFilter) setF({ ...EMPTY, ...initialFilter })
  }, [initKey])  // eslint-disable-line react-hooks/exhaustive-deps

  const catOpts = useMemo(
    () => [...new Set(txns.flatMap(effLabels))].sort(), [txns])
  const accOpts = useMemo(
    () => [...new Set(txns.map((t) => t.account_name))].sort(), [txns])
  // opções de subcategoria: restringe às categorias selecionadas (todas, se nenhuma)
  const subOpts = useMemo(() => {
    const inScope = f.cats.length
      ? txns.filter((t) => effLabels(t).some((c) => f.cats.includes(c)))
      : txns
    const subs = inScope.flatMap((t) =>
      t.splits?.length ? t.splits.map((s) => s.subcategory) : [t.subcategory])
    return [...new Set(subs.filter(Boolean))].sort()
  }, [txns, f.cats])

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
      if (f.sub && !tsubs.includes(f.sub)) return false
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
        const hay = `${t.description} ${t.counterparty || ''} ${t.category || ''} ${t.subcategory || ''}`.toLowerCase()
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
      cell: (c) => <span className="tnum text-muted">{fullDate(c.getValue())}</span> },
    {
      accessorKey: 'description', header: 'Descrição', enableSorting: false,
      cell: ({ row }) => (
        <div className="min-w-[180px]">
          <div className="flex items-center gap-1.5 font-medium">
            {row.original.description}
            {row.original.note && (
              <span title={row.original.note}
                className="inline-flex cursor-help text-amber"
                aria-label="nota">
                <StickyNote className="size-3.5" />
              </span>
            )}
          </div>
          {row.original.counterparty && (
            <div className="text-[12px] text-faint">{row.original.counterparty}</div>
          )}
          {row.original.note && (
            <div className="mt-0.5 line-clamp-1 text-[11.5px]
              italic text-faint" title={row.original.note}>
              “{row.original.note}”
            </div>
          )}
        </div>
      ),
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
        if (e.kind === 'split') {
          return (
            <div className="flex flex-wrap items-center gap-1.5">
              <Badge tone="violet">dividido</Badge>
              {e.splits.map((s, k) => (
                <CategoryTag key={k} size="xs" category={s.category}
                  title={`${s.category}${s.subcategory ? '/' + s.subcategory : ''} ${signedBrl(s.amount)}`}
                  onClick={() => pick(s.category)} />
              ))}
              {qb}{xb}
            </div>
          )
        }
        if (e.kind === 'uncat') {
          return (
            <span className="flex flex-wrap items-center gap-2">
              <CategoryTag uncategorized hint={e.hint}
                onClick={() => pick('Sem categoria')} />
              {t.needs_review && <Badge tone="amber">revisar</Badge>}
              {tb}{qb}{xb}
            </span>
          )
        }
        return (
          <span className="flex flex-wrap items-center gap-2">
            <CategoryTag category={e.label} onClick={() => pick(e.label)} />
            {t.needs_review && <Badge tone="amber">revisar</Badge>}
            {tb}{qb}{xb}
          </span>
        )
      },
    },
    {
      accessorKey: 'subcategory', header: 'Subcategoria', enableSorting: false,
      cell: ({ row }) => {
        const t = row.original
        if (t.splits?.length) return <span className="text-faint">—</span>
        const e = effectiveCategory(t)
        if (e.kind !== 'cat' || !e.subcategory) {
          return <span className="text-faint">—</span>
        }
        return (
          <button onClick={() => set('sub', e.subcategory)}
            className="whitespace-nowrap rounded-md px-1.5 py-0.5 text-[12.5px]
              text-muted hover:bg-surface2 hover:text-text"
            title="Filtrar por esta subcategoria">
            {e.subcategory}
          </button>
        )
      },
    },
    { accessorKey: 'account_name', header: 'Conta', enableSorting: false,
      cell: (c) => <span className="text-[12px] text-faint">{c.getValue()}</span> },
    {
      accessorKey: 'signed_amount', header: 'Valor',
      cell: (c) => (
        <span className={`tnum font-semibold ${c.getValue() >= 0
          ? 'text-green' : 'text-red'}`}>{signedBrl(c.getValue())}</span>
      ),
    },
    {
      id: 'act', header: '', enableSorting: false,
      cell: ({ row }) => (
        <button onClick={() => openEdit([row.original])}
          className="rounded-lg p-1.5 text-muted hover:bg-surface2
            hover:text-text" title="Editar">
          <Pencil className="size-3.5" />
        </button>
      ),
    },
  ], [openEdit, queuedIds, treatments])  // eslint-disable-line react-hooks/exhaustive-deps

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
    <div className="flex flex-wrap items-center justify-between gap-3 px-5
      py-3 text-[12.5px] text-muted">
      <div className="flex items-center gap-2">
        <span>Por página</span>
        <select value={table.getState().pagination.pageSize}
          onChange={(e) => table.setPageSize(+e.target.value)}
          className={inputCls('py-1')}>
          {[25, 50, 100, 200].map((n) => <option key={n}>{n}</option>)}
        </select>
        <span className="text-faint">· {rows.length} no total</span>
      </div>
      <div className="flex items-center gap-3">
        <span>
          Página {table.getState().pagination.pageIndex + 1} de{' '}
          {table.getPageCount() || 1}
        </span>
        <Button variant="ghost" onClick={() => table.previousPage()}
          disabled={!table.getCanPreviousPage()}>
          <ChevronLeft className="size-4" />
        </Button>
        <Button variant="ghost" onClick={() => table.nextPage()}
          disabled={!table.getCanNextPage()}>
          <ChevronRight className="size-4" />
        </Button>
      </div>
    </div>
  ) : null

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 pt-4">
        <h3 className="text-[15px] font-semibold">{title}</h3>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2
              text-faint" />
            <input value={f.q} onChange={(e) => set('q', e.target.value)}
              placeholder="Buscar…"
              className={inputCls('w-56 pl-9')} />
          </div>
          <Button variant={showFilters ? 'default' : 'ghost'}
            onClick={() => setShowFilters((s) => !s)}>
            <SlidersHorizontal className="size-4" /> Filtros
          </Button>
        </div>
      </div>

      {showFilters && (
        <div className="flex flex-wrap items-center gap-2 px-5 pb-3 pt-3">
          <MultiSelect label="Categoria" options={catOpts} value={f.cats}
            onChange={(v) => set('cats', v)} />
          <select value={f.sub} onChange={(e) => set('sub', e.target.value)}
            className={inputCls()}>
            <option value="">Subcategoria (todas)</option>
            {subOpts.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <MultiSelect label="Conta" options={accOpts} value={f.accs}
            onChange={(v) => set('accs', v)} />
          <select value={f.flow} onChange={(e) => set('flow', e.target.value)}
            className={inputCls()}>
            <option value="">Entradas + saídas</option>
            <option value="in">Só entradas</option>
            <option value="out">Só saídas</option>
          </select>
          <div className="flex items-center gap-1 text-[12px] text-muted">
            <input type="date" value={f.d0} onChange={(e) => set('d0', e.target.value)}
              className={inputCls('w-[140px]')} />
            <span>–</span>
            <input type="date" value={f.d1} onChange={(e) => set('d1', e.target.value)}
              className={inputCls('w-[140px]')} />
          </div>
          <div className="flex items-center gap-1 text-[12px] text-muted">
            <input type="number" placeholder="R$ mín" value={f.a0}
              onChange={(e) => set('a0', e.target.value)}
              className={inputCls('w-24')} />
            <span>–</span>
            <input type="number" placeholder="R$ máx" value={f.a1}
              onChange={(e) => set('a1', e.target.value)}
              className={inputCls('w-24')} />
          </div>
          <label className="flex items-center gap-2 rounded-xl border
            border-border bg-surface2 px-3 py-2 text-[12px] text-muted">
            <input type="checkbox" checked={f.rev}
              onChange={(e) => set('rev', e.target.checked)} />
            só a revisar
          </label>
          {qids.size > 0 && (
            <label className="flex items-center gap-2 rounded-xl border
              border-blue/40 bg-blue/10 px-3 py-2 text-[12px] text-blue">
              <input type="checkbox" checked={f.queued}
                onChange={(e) => set('queued', e.target.checked)} />
              só fila do Claude
            </label>
          )}
          {showExclToggle && (
            <label className="flex items-center gap-2 rounded-xl border
              border-amber/40 bg-amber/10 px-3 py-2 text-[12px] text-amber">
              <input type="checkbox" checked={f.excl}
                onChange={(e) => set('excl', e.target.checked)} />
              <EyeOff className="size-3.5" /> mostrar rasurados
              {viewExcl > 0
                ? <span className="tnum font-semibold">({viewExcl})</span>
                : <span className="text-amber/60">(nenhum neste mês)</span>}
            </label>
          )}
          {active && (
            <Button variant="ghost" onClick={() => setF(EMPTY)}>
              <X className="size-3.5" /> limpar
            </Button>
          )}
        </div>
      )}

      {/* barra-resumo do conjunto filtrado (padrão Monarch) */}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-1 border-y
        border-border bg-surface2/40 px-5 py-2.5 text-[12.5px]">
        <span className="text-muted">{rows.length} de {txns.length} lançamentos</span>
        <span className="text-green">entradas {brl(totIn)}</span>
        <span className="text-red">saídas {brl(totOut)}</span>
        <span className={totIn + totOut >= 0 ? 'text-green' : 'text-red'}>
          líquido {signedBrl(totIn + totOut)}</span>
      </div>

      {selected.length > 0 && (
        <div className="flex items-center justify-between gap-3 bg-brand/[0.08]
          px-5 py-2.5 text-[13px]">
          <span className="font-medium text-brand">
            {selected.length} selecionado(s)</span>
          <div className="flex gap-2">
            <Button variant="primary" onClick={() => openEdit(selected)}>
              <Pencil className="size-3.5" /> Editar em massa
            </Button>
            <Button variant="ghost" onClick={() => setSel({})}>limpar</Button>
          </div>
        </div>
      )}

      {pager && <div className="border-t border-border">{pager}</div>}

      <div className="overflow-x-auto">
        <table className="w-full text-[13px]">
          <thead>
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id} className="border-b border-border text-left">
                {hg.headers.map((h) => {
                  const sortable = h.column.getCanSort()
                  const dir = h.column.getIsSorted()
                  return (
                    <th key={h.id}
                      onClick={sortable ? h.column.getToggleSortingHandler() : undefined}
                      className={`whitespace-nowrap px-5 py-3 text-[11px]
                        font-semibold uppercase tracking-wide text-faint
                        ${sortable ? 'cursor-pointer select-none hover:text-muted' : ''}`}>
                      <span className="inline-flex items-center gap-1">
                        {flexRender(h.column.columnDef.header, h.getContext())}
                        {sortable && (dir === 'asc' ? <ArrowUp className="size-3" />
                          : dir === 'desc' ? <ArrowDown className="size-3" />
                            : <ArrowUpDown className="size-3 opacity-40" />)}
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
                    <tr key={`h-${day}`}>
                      <td colSpan={colCount}
                        className="border-y border-border bg-surface2/40
                          px-5 py-2">
                        <div className="flex items-center justify-between">
                          <span className="text-[12.5px] font-semibold
                            text-muted">{longDate(day)}</span>
                          <span className="text-[11.5px] text-faint">
                            {ag.count} lanç. · líquido{' '}
                            <span className={ag.net >= 0
                              ? 'text-green' : 'text-red'}>
                              {signedBrl(ag.net)}</span>
                          </span>
                        </div>
                      </td>
                    </tr>,
                  )
                }
                out.push(
                  <tr key={r.id}
                    className={`border-b border-border/60 hover:bg-white/[0.03]
                      ${r.original.excluded
                        ? 'opacity-45 [&_td]:line-through'
                        : r.getIsSelected() ? 'bg-brand/[0.07]'
                          : isQueued(r.original.id)
                            ? 'bg-blue/[0.05] border-l-2 border-l-blue/50' : ''}`}>
                    {r.getVisibleCells().map((c) => (
                      <td key={c.id} className="px-5 py-3 align-top">
                        {flexRender(c.column.columnDef.cell, c.getContext())}
                      </td>
                    ))}
                  </tr>,
                )
              }
              return out
            })()}
            {rows.length === 0 && (
              <tr><td colSpan={colCount} className="py-14 text-center
                text-faint">Nenhum lançamento com esses filtros.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {pager && <div className="border-t border-border">{pager}</div>}
    </Card>
  )
}
