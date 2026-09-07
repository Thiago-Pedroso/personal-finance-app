import { useState } from 'react'
import { PiggyBank, Plus } from 'lucide-react'

import { brl } from '../../lib/format.js'
import { Modal } from '../ui/Modal.jsx'
import { Button, Card, CardHead, Empty } from '../ui/primitives.jsx'
import { Money, pct } from './shared.jsx'

// Caixinha é ativo por saldo numa conta do tipo bucket. A instituição sabe o total,
// você sabe a divisão, e a diferença entre os dois é dinheiro a alocar.
function bucketsOf(data) {
  const accounts = Object.fromEntries((data.accounts || []).map((a) => [a.id, a]))
  const rows = data.positions.filter((position) =>
    position.valuation === 'balance' && accounts[position.account]?.kind === 'bucket')
  const groups = new Map()
  rows.forEach((row) => {
    const account = accounts[row.account]
    if (!groups.has(row.account)) groups.set(row.account, { account, rows: [] })
    groups.get(row.account).rows.push(row)
  })
  return [...groups.values()]
}

function UpdateModal({ bucket, onClose, onConfirm, busy }) {
  const [value, setValue] = useState(String(bucket.value.toFixed(2)))
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10))
  const parsed = Number(String(value).replace(',', '.')) || 0
  const difference = parsed - bucket.value

  return (
    <Modal open onOpenChange={(next) => !next && onClose()}
      title={`Atualizar ${bucket.name}`}
      sub="o saldo informado vira lançamento, e a diferença entra como rendimento">
      <div className="flex flex-col gap-3">
        <label className="flex items-center gap-3 text-[13px]">
          <span className="w-[70px] text-muted">Data</span>
          <input value={date} onChange={(e) => setDate(e.target.value)}
            className="rounded-lg border border-border bg-surface2 px-3 py-2" />
        </label>
        <label className="flex items-center gap-3 text-[13px]">
          <span className="w-[70px] text-muted">Saldo</span>
          <input value={value} inputMode="decimal"
            onChange={(e) => setValue(e.target.value)}
            className="tnum flex-1 rounded-lg border border-border bg-surface2 px-3
              py-2 text-right" />
        </label>
        <p className="text-[12px] text-faint">
          Saldo atual {brl(bucket.value)}.{' '}
          {Math.abs(difference) > 0.005 && (
            <span className={difference > 0 ? 'text-green' : 'text-red'}>
              {difference > 0 ? 'Rendimento' : 'Retirada'} de{' '}
              {brl(Math.abs(difference))}.
            </span>
          )}
        </p>
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button variant="primary" disabled={busy}
            onClick={() => onConfirm({ ticker: bucket.ticker, date, value: parsed })}>
            Gravar saldo</Button>
        </div>
      </div>
    </Modal>
  )
}

function NewBucketModal({ accountId, node, onClose, onConfirm, busy }) {
  const [name, setName] = useState('')
  const [value, setValue] = useState('')
  const ticker = name.trim().toUpperCase().replace(/[^A-Z0-9]+/g, '-').slice(0, 24)

  return (
    <Modal open onOpenChange={(next) => !next && onClose()} title="Nova caixinha"
      sub="uma caixinha é um saldo com nome: sem meta, sem prazo">
      <div className="flex flex-col gap-3">
        <label className="flex items-center gap-3 text-[13px]">
          <span className="w-[70px] text-muted">Nome</span>
          <input value={name} onChange={(e) => setName(e.target.value)}
            placeholder="Viagem"
            className="flex-1 rounded-lg border border-border bg-surface2 px-3 py-2" />
        </label>
        <label className="flex items-center gap-3 text-[13px]">
          <span className="w-[70px] text-muted">Saldo</span>
          <input value={value} inputMode="decimal"
            onChange={(e) => setValue(e.target.value)} placeholder="0,00"
            className="tnum flex-1 rounded-lg border border-border bg-surface2 px-3
              py-2 text-right" />
        </label>
        {ticker && <p className="text-[12px] text-faint">Identificador: {ticker}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button variant="primary" disabled={!ticker || busy}
            onClick={() => onConfirm({
              asset: { ticker, name: name.trim(), node, account: accountId,
                valuation: 'balance', target_pct: 0, sector: 'CDB' },
              balance: { ticker, value: Number(String(value).replace(',', '.')) || 0 },
            })}>Criar caixinha</Button>
        </div>
      </div>
    </Modal>
  )
}

export function Caixinhas({ data, onApply, busy }) {
  const [updating, setUpdating] = useState(null)
  const [creating, setCreating] = useState(null)
  const groups = bucketsOf(data)
  const pending = (data.pending?.buckets) || {}

  if (!groups.length) {
    return (
      <Empty>
        Nenhuma caixinha ainda. Crie uma conta com tipo <b>bucket</b> e um ativo por
        saldo dentro dela para acompanhar reserva e objetivos aqui.
      </Empty>
    )
  }

  const updateBalance = async ({ ticker, date, value }) => {
    await onApply({ balances: [{ ticker, date, value }] })
    setUpdating(null)
  }
  const createBucket = async ({ asset, balance }) => {
    await onApply({ assets: [asset], balances: [balance] })
    setCreating(null)
  }

  return (
    <div className="flex flex-col gap-4">
      {groups.map(({ account, rows }) => {
        const total = rows.reduce((sum, row) => sum + row.value, 0)
        const report = pending[account.id]
        const unallocated = report?.unallocated ?? 0
        return (
          <Card key={account.id}>
            <CardHead title={account.name}
              sub={report
                ? `a instituição informa ${brl(report.total)}`
                : 'saldos informados por você'}
              right={
                <Button variant="ghost"
                  onClick={() => setCreating({ accountId: account.id,
                    node: rows[0]?.node })}>
                  <Plus className="size-4" /> Caixinha
                </Button>
              } />
            <div className="flex flex-col gap-2 px-5 pb-4">
              {rows.map((row) => (
                <button key={row.ticker} onClick={() => setUpdating(row)}
                  className="grid grid-cols-[1fr_auto] items-center gap-3 rounded-xl
                    px-3 py-2 text-left hover:bg-surface2/60 sm:grid-cols-[1fr_120px_auto]">
                  <div>
                    <p className="text-[13.5px] font-semibold">{row.name}</p>
                    <p className="text-[11px] text-faint">
                      {row.last_balance_date
                        ? `atualizado em ${row.last_balance_date}`
                        : 'sem atualização'}
                      {row.income > 0 && ` · rendeu ${brl(row.income)}`}
                    </p>
                  </div>
                  <div className="hidden h-1.5 overflow-hidden rounded-full bg-surface2
                    sm:block">
                    <div className="h-full rounded-full bg-brand/70"
                      style={{ width: `${total ? (row.value / total) * 100 : 0}%` }} />
                  </div>
                  <span className="tnum text-[13.5px]"><Money value={row.value} /></span>
                </button>
              ))}
              <div className="flex items-center justify-between border-t border-border/60
                px-3 pt-3 text-[13px]">
                <span className="text-muted">Soma das caixinhas</span>
                <span className="tnum font-semibold"><Money value={total} /></span>
              </div>
              {report && Math.abs(unallocated) > 0.01 && (
                <p className={`px-3 text-[12px] ${unallocated > 0 ? 'text-amber' : 'text-red'}`}>
                  {unallocated > 0
                    ? `${brl(unallocated)} na instituição ainda não estão em nenhuma caixinha.`
                    : `As caixinhas somam ${brl(-unallocated)} a mais que a instituição informa.`}
                </p>
              )}
              {report && Math.abs(unallocated) <= 0.01 && (
                <p className="px-3 text-[12px] text-green">Confere com a instituição.</p>
              )}
            </div>
          </Card>
        )
      })}

      <p className="flex items-center gap-2 px-1 text-[12px] text-faint">
        <PiggyBank className="size-3.5" />
        Caixinha fica fora do rebalanceamento: aparece no patrimônio e não recebe aporte
        automático.
      </p>

      {updating && (
        <UpdateModal bucket={updating} busy={busy}
          onClose={() => setUpdating(null)} onConfirm={updateBalance} />
      )}
      {creating && (
        <NewBucketModal accountId={creating.accountId} node={creating.node} busy={busy}
          onClose={() => setCreating(null)} onConfirm={createBucket} />
      )}
    </div>
  )
}
