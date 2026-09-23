import { Plus, Trash2, Landmark, Sparkles } from 'lucide-react'
import { inputCls } from './ui/MultiSelect.jsx'
import { Button } from './ui/primitives.jsx'
import { brl } from '../lib/format.js'
import {
  destinationBalance, groupDestinations, simulatorSuggestions,
} from '../lib/destinations.js'

export function DestinationEditor({ rows, setRows, needed, withdrawal, destinations,
  simulator, onTouch }) {
  const groups = groupDestinations(destinations)
  const byTicker = Object.fromEntries((destinations || []).map((item) => [item.ticker, item]))
  const { linked, rest, closes, over } = destinationBalance(rows, needed)
  const used = new Set(rows.map((row) => row.ticker))
  const suggestions = simulatorSuggestions(simulator, destinations)
    .filter((item) => !used.has(item.ticker) && item.amount <= rest + 0.009)

  const update = (next) => { setRows(next); onTouch() }
  const setRow = (index, key, value) => update(rows.map((row, position) =>
    position === index ? { ...row, [key]: value } : row))
  const addRow = (row) => update([
    ...rows.filter((item) => item.ticker || Number(item.amount)),
    row || { ticker: '', amount: rest > 0 ? String(rest) : '' }])
  const removeRow = (index) => update(rows.filter((_, position) => position !== index))

  return (
    <div className="mt-4 rounded-xl border border-violet/30 bg-violet/5 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-[12px] font-semibold text-violet">
          <Landmark className="size-3.5" />
          {withdrawal ? 'De onde saiu no investimento' : 'Para onde foi no investimento'}
        </div>
        <span className="tnum text-[12px] text-muted">
          {brl(needed)} {withdrawal ? 'resgatados' : 'guardados'}
        </span>
      </div>

      <div className="mt-2 flex flex-col gap-2">
        {rows.map((row, index) => {
          const current = byTicker[row.ticker]
          return (
            <div key={index} className="flex flex-wrap items-center gap-2 sm:flex-nowrap">
              <select value={row.ticker}
                onChange={(event) => setRow(index, 'ticker', event.target.value)}
                aria-label="Destino"
                className={inputCls('min-w-0 flex-1 basis-48')}>
                <option value="">escolha o envelope…</option>
                {groups.map((group) => (
                  <optgroup key={group.label} label={group.label}>
                    {group.items.map((item) => (
                      <option key={item.ticker} value={item.ticker}
                        disabled={used.has(item.ticker) && item.ticker !== row.ticker}>
                        {item.name}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
              <input type="number" step="0.01" min="0" value={row.amount}
                onChange={(event) => setRow(index, 'amount', event.target.value)}
                aria-label="Valor" placeholder="valor"
                className={inputCls('tnum w-28')} />
              <button type="button" onClick={() => removeRow(index)}
                title="Tirar este destino"
                className="rounded-lg p-1.5 text-muted hover:text-red">
                <Trash2 className="size-4" />
              </button>
              {current && (
                <div className="w-full text-[11px] text-faint sm:hidden">
                  hoje com {brl(current.value)}
                </div>
              )}
            </div>
          )
        })}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Button variant="ghost" onClick={() => addRow()}>
          <Plus className="size-4" /> destino
        </Button>
        <span className={`ml-auto text-[12px] tnum ${closes ? 'text-green'
          : over ? 'text-red' : 'text-amber'}`}>
          {closes ? 'fecha ✓'
            : over ? `passa ${brl(-rest)} do valor`
              : linked ? `faltam ${brl(rest)}` : 'sem destino ainda'}
        </span>
      </div>

      {suggestions.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <span className="inline-flex items-center gap-1 text-[11px] text-faint">
            <Sparkles className="size-3" /> do simulador
          </span>
          {suggestions.map((item) => (
            <button key={item.ticker} type="button"
              onClick={() => addRow({ ticker: item.ticker, amount: String(item.amount) })}
              className="rounded-full border border-border bg-surface2 px-2 py-0.5
                text-[11.5px] text-muted hover:border-violet/50 hover:text-text">
              {item.name} <span className="tnum">{brl(item.amount)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
