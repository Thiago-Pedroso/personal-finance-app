import { useMemo, useState } from 'react'
import { Plus, RefreshCcw } from 'lucide-react'

import { brl, fullDate } from '../../lib/format.js'
import { Modal } from '../ui/Modal.jsx'
import { Badge, Button, Card, Empty } from '../ui/primitives.jsx'
import { SensitiveAmount } from '../ui/SensitiveValue.jsx'
import { InvestmentCardHeader, InvestmentPageHeader } from './shared.jsx'

const SIDES = [
  ['BUY', 'Compra'], ['SELL', 'Venda'], ['DIVIDEND', 'Provento'],
  ['JCP', 'JCP'], ['BALANCE', 'Saldo informado'], ['SPLIT', 'Desdobramento'],
]
const TONE = { BUY: 'blue', SELL: 'amber', DIVIDEND: 'green', JCP: 'green',
  BALANCE: 'violet', SPLIT: 'muted', ADJUST: 'muted' }
const label = (side) => (SIDES.find(([key]) => key === side) || [side, side])[1]

function NewTradeModal({ tickers, accounts, onClose, onConfirm, busy }) {
  const [form, setForm] = useState({
    date: new Date().toISOString().slice(0, 10), ticker: tickers[0] || '',
    side: 'BUY', quantity: '', price: '', account: accounts[0]?.id || '', note: '',
  })
  const set = (field, value) => setForm((current) => ({ ...current, [field]: value }))
  const number = (text) => Number(String(text).replace(',', '.')) || 0
  const balanceLike = form.side === 'BALANCE'

  return (
    <Modal open onOpenChange={(next) => !next && onClose()} title="Nova movimentação"
      sub="Registre compras, vendas, proventos e atualizações de saldo.">
      <div className="flex flex-col gap-3 text-[14px]">
        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-muted">Data</span>
            <input value={form.date} onChange={(e) => set('date', e.target.value)}
              className="rounded-lg border border-border bg-surface2 px-3 py-2" />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-muted">Operação</span>
            <select value={form.side} onChange={(e) => set('side', e.target.value)}
              className="rounded-lg border border-border bg-surface2 px-3 py-2">
              {SIDES.map(([key, text]) => <option key={key} value={key}>{text}</option>)}
            </select>
          </label>
        </div>
        <label className="flex flex-col gap-1">
          <span className="text-muted">Ativo</span>
          <input value={form.ticker} list="invest-tickers"
            onChange={(e) => set('ticker', e.target.value.toUpperCase())}
            className="rounded-lg border border-border bg-surface2 px-3 py-2" />
          <datalist id="invest-tickers">
            {tickers.map((ticker) => <option key={ticker} value={ticker} />)}
          </datalist>
        </label>
        <div className="grid grid-cols-2 gap-3">
          {!balanceLike && (
            <label className="flex flex-col gap-1">
              <span className="text-muted">Quantidade</span>
              <input value={form.quantity} inputMode="decimal"
                onChange={(e) => set('quantity', e.target.value)}
                className="tnum rounded-lg border border-border bg-surface2 px-3 py-2
                  text-right" />
            </label>
          )}
          <label className="flex flex-col gap-1">
            <span className="text-muted">
              {balanceLike ? 'Saldo' : form.side === 'SPLIT' ? 'Fator' : 'Preço'}</span>
            <input value={form.price} inputMode="decimal"
              onChange={(e) => set('price', e.target.value)}
              className="tnum rounded-lg border border-border bg-surface2 px-3 py-2
                text-right" />
          </label>
        </div>
        <label className="flex flex-col gap-1">
          <span className="text-muted">Conta</span>
          <select value={form.account} onChange={(e) => set('account', e.target.value)}
            className="rounded-lg border border-border bg-surface2 px-3 py-2">
            {accounts.map((account) => (
              <option key={account.id} value={account.id}>{account.name}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-muted">Observação</span>
          <input value={form.note} onChange={(e) => set('note', e.target.value)}
            className="rounded-lg border border-border bg-surface2 px-3 py-2" />
        </label>
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button variant="primary" disabled={!form.ticker || busy}
            onClick={() => onConfirm({
              date: form.date, ticker: form.ticker, side: form.side,
              quantity: form.side === 'SPLIT' ? number(form.price) : number(form.quantity),
              price: form.side === 'SPLIT' ? 0 : number(form.price),
              account: form.account, note: form.note || null,
            })}>Gravar</Button>
        </div>
      </div>
    </Modal>
  )
}

export function Operacoes({ data, onApply, onSync, busy }) {
  const [creating, setCreating] = useState(false)
  const [filter, setFilter] = useState('')
  const trades = data.trades || []
  const tickers = useMemo(() =>
    [...new Set(data.positions.map((position) => position.ticker))].sort(),
  [data.positions])

  const rows = useMemo(() => {
    const text = filter.trim().toUpperCase()
    return [...trades]
      .filter((trade) => !text || trade.ticker.includes(text))
      .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
  }, [trades, filter])

  const realized = data.totals?.realized || 0

  return (
    <div className="flex flex-col gap-6">
      <InvestmentPageHeader eyebrow="Movimentações" title="Histórico da carteira"
        description="Consulte os lançamentos que formam suas posições e registre novas operações." />

      <Card>
        <InvestmentCardHeader title="Lançamentos"
          description={`${trades.length} movimentações registradas${realized
            ? `. Resultado realizado de ${brl(realized)}.` : '.'}`}
          right={
            <span className="flex flex-wrap gap-2">
              <Button variant="ghost" onClick={onSync} disabled={busy}>
                <RefreshCcw className="size-4" /> Conferir com as corretoras
              </Button>
              <Button variant="primary" onClick={() => setCreating(true)}>
                <Plus className="size-4" /> Nova
              </Button>
            </span>
          } />
        <div className="px-5 pb-4 sm:px-6">
          <label htmlFor="trade-filter" className="mb-2 block text-[14px]
            font-semibold text-secondary">Filtrar por ativo</label>
          <input value={filter} onChange={(e) => setFilter(e.target.value)}
            id="trade-filter" placeholder="Exemplo: VOO"
            className="min-h-11 w-full rounded-xl border border-border bg-surface2
              px-3 text-[14px] sm:w-[280px]" />
        </div>
        <div className="overflow-x-auto">
          <table className="invest-table invest-responsive-table w-full text-[15px]">
            <thead className="bg-table-head text-[14px] text-strong">
              <tr className="h-16 border-b border-white/15">
                <th className="px-5 text-left font-bold">Data</th>
                <th className="px-3 text-left font-bold">Ativo</th>
                <th className="px-3 text-left font-bold">Operação</th>
                <th className="px-3 text-right font-bold">Quantidade</th>
                <th className="px-3 text-right font-bold">Preço</th>
                <th className="px-3 text-right font-bold">Total</th>
                <th className="px-5 text-left font-bold">Conta</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((trade) => {
                const total = trade.side === 'BALANCE' || !trade.quantity
                  ? trade.price
                  : trade.quantity * trade.price * (trade.fx_rate || 1)
                return (
                  <tr key={trade.id} className="min-h-[72px] border-b border-border/60
                    last:border-0">
                    <td data-label="Data" className="tnum px-5 py-4 text-secondary">
                      {fullDate(trade.date)}</td>
                    <td data-primary="true" data-label="Ativo"
                      className="px-3 py-4 font-bold text-strong">{trade.ticker}</td>
                    <td data-label="Operação" className="px-3 py-4">
                      <Badge tone={TONE[trade.side] || 'muted'}>{label(trade.side)}</Badge>
                    </td>
                    <td data-label="Quantidade" className="tnum px-3 py-4 text-right
                      text-secondary">
                      {trade.quantity
                        ? trade.quantity.toLocaleString('pt-BR',
                          { maximumFractionDigits: 8 }) : '—'}</td>
                    <td data-label="Preço" className="tnum px-3 py-4 text-right
                      text-secondary">
                      {trade.side === 'BALANCE' ? '—' : brl(trade.price)}
                      {trade.currency && trade.currency !== 'BRL' && (
                        <span className="ml-1 text-[12px] text-subtle">
                          {trade.currency}</span>
                      )}</td>
                    <td data-label="Total" className="tnum px-3 py-4 text-right
                      font-semibold text-brand-soft">
                      <SensitiveAmount>{brl(total)}</SensitiveAmount></td>
                    <td data-label="Conta" className="px-5 py-4 text-secondary">
                      {trade.account || '—'}</td>
                  </tr>
                )
              })}
              {rows.length === 0 && (
                <tr><td colSpan="7" data-empty="true">
                  <Empty>Nenhuma movimentação registrada.</Empty></td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {creating && (
        <NewTradeModal tickers={tickers} accounts={data.accounts || []} busy={busy}
          onClose={() => setCreating(false)}
          onConfirm={async (trade) => { await onApply({ trades: [trade] })
            setCreating(false) }} />
      )}
    </div>
  )
}
