import { useMemo, useState } from 'react'
import { ChevronRight, Lock, LockOpen, RefreshCw } from 'lucide-react'

import { brl } from '../../lib/format.js'
import { orderPortfolioNodes } from '../../lib/investPolicy.js'
import { Button, Card, Empty } from '../ui/primitives.jsx'
import { DriftChip, InvestmentPageHeader, Money, pct, Profit } from './shared.jsx'

const number = (value, places = 2) =>
  (value ?? 0).toLocaleString('pt-BR', { maximumFractionDigits: places })

// Redistribuição do alvo: mexer num papel reflui os destravados. Mesma regra do Python,
// que confere de novo ao gravar.
function redistribute(targets, changed, locked) {
  const frozen = new Set([...locked, ...Object.keys(changed)])
  const result = { ...targets, ...changed }
  const free = Object.keys(result).filter((key) => !frozen.has(key))
  if (!free.length) return result
  const taken = Object.keys(result).filter((key) => frozen.has(key))
    .reduce((sum, key) => sum + result[key], 0)
  const base = free.reduce((sum, key) => sum + (targets[key] || 0), 0)
  free.forEach((key) => {
    const share = base > 0 ? (targets[key] || 0) / base : 1 / free.length
    result[key] = Math.max(0, (1 - taken) * share)
  })
  return result
}

function TargetEditor({ node, rows, onSave, busy }) {
  const initial = useMemo(() => Object.fromEntries(
    rows.map((row) => [row.ticker, row.target_pct])), [rows])
  const [targets, setTargets] = useState(initial)
  const [locked, setLocked] = useState(new Set())
  const [draft, setDraft] = useState(null)
  const sum = Object.values(targets).reduce((a, b) => a + b, 0)
  const dirty = rows.some((row) => Math.abs(targets[row.ticker] - initial[row.ticker]) > 1e-9)

  const change = (ticker, text) => {
    const value = Number(String(text).replace(',', '.')) / 100
    if (Number.isNaN(value)) return
    setTargets((current) => redistribute(current, { [ticker]: value }, locked))
  }
  const toggleLock = (ticker) => setLocked((current) => {
    const next = new Set(current)
    next.has(ticker) ? next.delete(ticker) : next.add(ticker)
    return next
  })

  return {
    targets, sum, dirty, locked, draft, setDraft, change, toggleLock,
    reset: () => { setTargets(initial); setLocked(new Set()) },
    save: () => onSave(node, targets, [...locked]),
    busy,
  }
}

function ClassBlock({ node, rows, editor, open, onToggle }) {
  const value = rows.reduce((sum, row) => sum + row.value, 0)
  const cost = rows.reduce((sum, row) => sum + row.cost, 0)
  const profit = value - cost
  const off = node.in_totals && Math.abs(editor.sum - 1) > 0.005

  return (
    <Card>
      <button onClick={onToggle}
        className="flex min-h-[76px] w-full items-center gap-4 px-5 py-4 text-left
          hover:bg-surface2/35 sm:px-6">
        <ChevronRight className={`size-5 text-secondary transition ${open ? 'rotate-90' : ''}`} />
        <span className="flex-1 text-[18px] font-bold text-strong">{node.name}</span>
        <span className="tnum text-[16px] font-semibold text-strong">
          <Money value={value} /></span>
        <span className="hidden md:block"><Profit value={profit}
          pctValue={cost ? profit / cost : null} /></span>
        {node.in_totals
          ? <DriftChip drift={node.drift} />
          : <span className="rounded-full border border-border bg-white/5 px-2.5
              py-1 text-[12px] font-semibold text-secondary">
              Fora da estratégia</span>}
      </button>

      {open && (
        <div className="overflow-x-auto border-t border-border/60">
          <table className="invest-table invest-responsive-table w-full text-[15px]">
            <thead className="bg-table-head text-[14px] text-strong">
              <tr className="h-16 border-b border-white/15">
                <th className="px-5 text-left font-bold">Ativo</th>
                <th className="px-3 text-left font-bold">Setor</th>
                <th className="px-3 text-right font-bold">Posição</th>
                <th className="px-3 text-right font-bold">Quantidade</th>
                <th className="px-3 text-right font-bold">Preço médio</th>
                <th className="px-3 text-right font-bold">Cotação</th>
                <th className="px-3 text-right font-bold">Rentabilidade</th>
                <th className="px-3 text-right font-bold">Atual</th>
                <th className="px-3 text-right font-bold">Objetivo</th>
                <th className="px-2 py-2" />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const real = value ? row.value / value : 0
                const target = editor.targets[row.ticker] ?? row.target_pct
                return (
                  <tr key={row.ticker} className="min-h-[72px] border-b border-border/60
                    last:border-0">
                    <td data-primary="true" data-label="Ativo" className="px-5 py-4">
                      <span className="font-bold text-strong">{row.ticker}</span>
                      {row.stale && <span className="ml-2 text-[12px] text-attention"
                        title="Cotação defasada ou indisponível">defasada</span>}
                    </td>
                    <td data-label="Setor" className="px-3 py-4 text-secondary">
                      {row.sector || '—'}</td>
                    <td data-label="Posição" className="tnum px-3 py-4 text-right
                      font-semibold text-brand-soft"><Money value={row.value} /></td>
                    <td data-label="Quantidade" className="tnum px-3 py-4 text-right
                      text-secondary">
                      {row.quantity ? number(row.quantity, 8) : '—'}</td>
                    <td data-label="Preço médio" className="tnum px-3 py-4 text-right
                      text-secondary">
                      {row.avg_price ? brl(row.avg_price) : '—'}</td>
                    <td data-label="Cotação" className="tnum px-3 py-4 text-right
                      text-secondary">
                      {row.price ? brl(row.price) : '—'}</td>
                    <td data-label="Rentabilidade" className="px-3 py-4 text-right">
                      <Profit value={row.profit} pctValue={row.profit_pct} /></td>
                    <td data-label="Atual" className="tnum px-3 py-4 text-right
                      text-secondary">{pct(real)}</td>
                    <td data-label="Objetivo" className="px-3 py-4 text-right">
                      {node.in_totals ? (
                        <input value={(target * 100).toFixed(1)}
                          onChange={(e) => editor.change(row.ticker, e.target.value)}
                          inputMode="decimal"
                          className="tnum w-[72px] rounded-lg border border-border
                            bg-surface2 px-2 py-2 text-right text-[15px]
                            focus:border-brand" />
                      ) : <span className="text-subtle">Não se aplica</span>}
                    </td>
                    <td data-label="Travar objetivo" className="px-2 py-4">
                      {node.in_totals && (
                        <button onClick={() => editor.toggleLock(row.ticker)}
                          title={editor.locked.has(row.ticker)
                            ? 'Alvo travado' : 'Travar alvo'}
                          className={`rounded-lg p-2 ${editor.locked.has(row.ticker)
                            ? 'text-brand' : 'text-subtle hover:text-secondary'}`}>
                          {editor.locked.has(row.ticker)
                            ? <Lock className="size-3.5" />
                            : <LockOpen className="size-3.5" />}
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>

          {node.in_totals && (
            <div className="flex flex-wrap items-center justify-between gap-3 border-t
              border-border/60 px-5 py-4">
              <span className={`tnum text-[14px]
                ${off ? 'text-attention' : 'text-projected'}`}>
                Soma dos objetivos: {pct(editor.sum)}
                {off && '. Ajuste antes de salvar.'}
              </span>
              {editor.dirty && (
                <span className="flex gap-2">
                  <Button variant="ghost" onClick={editor.reset}>Descartar</Button>
                  <Button variant="primary" onClick={editor.save} disabled={editor.busy}>
                    Salvar objetivos</Button>
                </span>
              )}
            </div>
          )}
        </div>
      )}
    </Card>
  )
}

export function Carteira({ data, onSaveTargets, onRefresh, busy }) {
  const orderedAllocation = useMemo(
    () => orderPortfolioNodes(data.allocation, data.policy || []),
    [data.allocation, data.policy],
  )
  const [open, setOpen] = useState(() => new Set([
    orderedAllocation.find((node) => node.in_totals)?.node || orderedAllocation[0]?.node,
  ]))
  const byNode = useMemo(() => {
    const out = {}
    data.positions.forEach((position) => {
      (out[position.node] ||= []).push(position)
    })
    Object.values(out).forEach((rows) => rows.sort((a, b) => b.value - a.value))
    return out
  }, [data.positions])

  const editors = {}
  data.allocation.forEach((node) => {
    editors[node.node] = TargetEditor({
      node: node.node, rows: byNode[node.node] || [], onSave: onSaveTargets, busy })
  })

  const quotes = Object.values(data.quotes || {})
  const stale = quotes.filter((quote) => quote.stale).length
  const updated = quotes.map((quote) => quote.updated_at).filter(Boolean).sort().pop()

  if (!data.positions.length) {
    return (
      <div className="flex flex-col gap-6">
        <InvestmentPageHeader eyebrow="Carteira" title="Posições e objetivos"
          description="Consulte cada classe, acompanhe o desempenho e ajuste os objetivos dos ativos." />
        <Card><Empty>Nenhum ativo cadastrado ainda.</Empty></Card>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <InvestmentPageHeader eyebrow="Carteira" title="Posições e objetivos"
        description="Consulte cada classe, acompanhe o desempenho e ajuste os objetivos dos ativos." />

      <div className="flex flex-col gap-4">
        {orderedAllocation.filter((node) => (byNode[node.node] || []).length).map((node) => (
          <ClassBlock key={node.node} node={node} rows={byNode[node.node]}
            editor={editors[node.node]} open={open.has(node.node)}
            onToggle={() => setOpen((current) => {
              const next = new Set(current)
              next.has(node.node) ? next.delete(node.node) : next.add(node.node)
              return next
            })} />
        ))}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 px-1 text-[14px]
        text-subtle">
        <span>
          {updated ? `Cotações de ${updated.replace('T', ' ').slice(0, 16)}` : 'Sem cotações'}
          {stale > 0 && <span className="ml-2 text-amber">{stale} defasada(s)</span>}
        </span>
        <Button variant="ghost" onClick={onRefresh} disabled={busy}>
          <RefreshCw className={`size-3.5 ${busy ? 'animate-[spin_.8s_linear_infinite]' : ''}`} />
          Atualizar cotações
        </Button>
      </div>
    </div>
  )
}
