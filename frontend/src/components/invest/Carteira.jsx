import { useMemo, useState } from 'react'
import { ChevronRight, Lock, LockOpen, RefreshCw } from 'lucide-react'

import { brl } from '../../lib/format.js'
import { Button, Card, CardHead, Empty } from '../ui/primitives.jsx'
import { SensitiveAmount } from '../ui/SensitiveValue.jsx'
import { DriftChip, Money, pct, Profit, signedPct } from './shared.jsx'

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
  const off = Math.abs(editor.sum - 1) > 0.005

  return (
    <Card>
      <button onClick={onToggle}
        className="flex w-full items-center gap-3 px-5 py-4 text-left">
        <ChevronRight className={`size-4 text-muted transition ${open ? 'rotate-90' : ''}`} />
        <span className="flex-1 text-[14px] font-bold">{node.name}</span>
        <span className="tnum text-[13px]"><Money value={value} /></span>
        <span className="hidden sm:block"><Profit value={profit}
          pctValue={cost ? profit / cost : null} /></span>
        {node.in_totals
          ? <DriftChip drift={node.drift} />
          : <span className="rounded-full bg-white/5 px-2 py-0.5 text-[11px] text-faint">
              fora dos alvos</span>}
      </button>

      {open && (
        <div className="overflow-x-auto border-t border-border/60">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="text-[11px] uppercase tracking-wider text-faint">
                <th className="px-5 py-2 text-left font-medium">Ativo</th>
                <th className="px-3 py-2 text-left font-medium">Setor</th>
                <th className="px-3 py-2 text-right font-medium">Posição</th>
                <th className="px-3 py-2 text-right font-medium">Qtd</th>
                <th className="px-3 py-2 text-right font-medium">Preço médio</th>
                <th className="px-3 py-2 text-right font-medium">Cotação</th>
                <th className="px-3 py-2 text-right font-medium">Rentab.</th>
                <th className="px-3 py-2 text-right font-medium">% real</th>
                <th className="px-3 py-2 text-right font-medium">% obj</th>
                <th className="px-2 py-2" />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const real = value ? row.value / value : 0
                const target = editor.targets[row.ticker] ?? row.target_pct
                return (
                  <tr key={row.ticker} className="border-t border-border/40">
                    <td className="px-5 py-2">
                      <span className="font-semibold">{row.ticker}</span>
                      {row.stale && <span className="ml-2 text-[11px] text-amber"
                        title="Cotação defasada ou indisponível">defasada</span>}
                    </td>
                    <td className="px-3 py-2 text-muted">{row.sector || '—'}</td>
                    <td className="tnum px-3 py-2 text-right"><Money value={row.value} /></td>
                    <td className="tnum px-3 py-2 text-right text-muted">
                      {row.quantity ? number(row.quantity, 8) : '—'}</td>
                    <td className="tnum px-3 py-2 text-right text-muted">
                      {row.avg_price ? brl(row.avg_price) : '—'}</td>
                    <td className="tnum px-3 py-2 text-right text-muted">
                      {row.price ? brl(row.price) : '—'}</td>
                    <td className="px-3 py-2 text-right">
                      <Profit value={row.profit} pctValue={row.profit_pct} /></td>
                    <td className="tnum px-3 py-2 text-right text-muted">{pct(real)}</td>
                    <td className="px-3 py-2 text-right">
                      <input value={(target * 100).toFixed(1)}
                        onChange={(e) => editor.change(row.ticker, e.target.value)}
                        inputMode="decimal"
                        className="tnum w-[64px] rounded-lg border border-border
                          bg-surface2 px-2 py-1 text-right focus:border-brand" />
                    </td>
                    <td className="px-2 py-2">
                      <button onClick={() => editor.toggleLock(row.ticker)}
                        title={editor.locked.has(row.ticker)
                          ? 'Alvo travado' : 'Travar alvo'}
                        className={`rounded-lg p-1.5 ${editor.locked.has(row.ticker)
                          ? 'text-brand' : 'text-faint hover:text-muted'}`}>
                        {editor.locked.has(row.ticker)
                          ? <Lock className="size-3.5" />
                          : <LockOpen className="size-3.5" />}
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t
            border-border/60 px-5 py-3">
            <span className={`tnum text-[12px] ${off ? 'text-amber' : 'text-green'}`}>
              Soma dos alvos: {pct(editor.sum)}
              {off && ' — normalize antes de salvar ou deixe assim e o app avisa'}
            </span>
            {editor.dirty && (
              <span className="flex gap-2">
                <Button variant="ghost" onClick={editor.reset}>Descartar</Button>
                <Button variant="primary" onClick={editor.save} disabled={editor.busy}>
                  Salvar alvos</Button>
              </span>
            )}
          </div>
        </div>
      )}
    </Card>
  )
}

export function Carteira({ data, onSaveTargets, onRefresh, busy }) {
  const [open, setOpen] = useState(() => new Set([data.allocation[0]?.node]))
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

  if (!data.positions.length) return <Empty>Nenhum ativo cadastrado ainda.</Empty>

  return (
    <div className="flex flex-col gap-3">
      {data.allocation.filter((node) => (byNode[node.node] || []).length).map((node) => (
        <ClassBlock key={node.node} node={node} rows={byNode[node.node]}
          editor={editors[node.node]} open={open.has(node.node)}
          onToggle={() => setOpen((current) => {
            const next = new Set(current)
            next.has(node.node) ? next.delete(node.node) : next.add(node.node)
            return next
          })} />
      ))}

      <div className="flex flex-wrap items-center justify-between gap-3 px-1 text-[12px]
        text-faint">
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
