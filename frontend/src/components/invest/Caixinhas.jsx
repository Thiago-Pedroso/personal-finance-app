import { useState } from 'react'
import { CheckCircle2, PiggyBank, Plus, TriangleAlert } from 'lucide-react'

import { brl, money } from '../../lib/format.js'
import { buildBucketReconciliations } from '../../lib/investBuckets.js'
import { Modal } from '../ui/Modal.jsx'
import { Button, Card, Empty } from '../ui/primitives.jsx'
import { InvestmentCardHeader, InvestmentPageHeader, Money } from './shared.jsx'

// Tudo que não é posição de mercado: reserva com destino, dinheiro esperando aporte e
// saldo sem compromisso. Cada linha é um saldo com nome, e o papel vem do nó da política.
const ROLES = [
  ['reserved', 'Reservas', 'guardado com um destino'],
  ['to_invest', 'A aportar', 'saiu da conta e ainda não virou posição'],
  ['free', 'Livre', 'sem compromisso'],
]

function roleOfNode(data) {
  const roles = {}
  ;(data.policy || []).forEach((node) => { roles[node.node] = node.role })
  return roles
}

function groupsOf(data) {
  const roles = roleOfNode(data)
  const accounts = Object.fromEntries((data.accounts || []).map((a) => [a.id, a]))
  const out = []
  ROLES.forEach(([role, title, hint]) => {
    const rows = data.positions.filter((position) =>
      roles[position.node] === role && position.valuation !== 'quote')
    if (rows.length) {
      out.push({ role, title, hint, accounts,
        rows: [...rows].sort((a, b) => b.value - a.value) })
    }
  })
  return out
}

// Num saldo em moeda estrangeira quem se informa é a moeda de origem: o câmbio é do app,
// nunca do usuário.
function UpdateModal({ bucket, onClose, onConfirm, busy }) {
  const currency = bucket.currency || 'BRL'
  const rate = currency === 'BRL' ? 1 : (bucket.fx_rate || null)
  const current = currency === 'BRL' ? bucket.value : (bucket.native_value || 0)
  const [value, setValue] = useState(String(current.toFixed(2)))
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10))
  const parsed = Number(String(value).replace(',', '.')) || 0
  const difference = parsed - current

  return (
    <Modal open onOpenChange={(next) => !next && onClose()}
      title={`Atualizar ${bucket.name}`}
      sub={currency === 'BRL'
        ? 'Informe o saldo atual para registrar a variação.'
        : `Informe o saldo atual em ${currency}. A conversão para reais é do app.`}>
      <div className="flex flex-col gap-3">
        <label className="flex items-center gap-3 text-[14px]">
          <span className="w-[70px] text-secondary">Data</span>
          <input value={date} onChange={(e) => setDate(e.target.value)}
            className="rounded-lg border border-border bg-surface2 px-3 py-2" />
        </label>
        <label className="flex items-center gap-3 text-[14px]">
          <span className="w-[70px] text-secondary">
            Saldo{currency !== 'BRL' && (
              <span className="ml-1 text-[12px] text-faint">{currency}</span>)}
          </span>
          <input value={value} inputMode="decimal"
            onChange={(e) => setValue(e.target.value)}
            className="tnum flex-1 rounded-lg border border-border bg-surface2 px-3
              py-2 text-right" />
        </label>
        <p className="text-[14px] text-subtle">
          Saldo atual {money(current, currency)}.{' '}
          {Math.abs(difference) > 0.005 && (
            <span className={difference > 0 ? 'text-green' : 'text-red'}>
              {difference > 0 ? 'Rendimento' : 'Retirada'} de{' '}
              {money(Math.abs(difference), currency)}.
            </span>
          )}
          {currency !== 'BRL' && rate && (
            <span className="block text-[13px] text-faint">
              {brl(parsed * rate)} pelo câmbio de hoje,
              {' '}{rate.toFixed(4).replace('.', ',')} por {currency}.
            </span>
          )}
          {currency !== 'BRL' && !rate && (
            <span className="block text-[13px] text-amber">
              Sem cotação {currency}/BRL: o valor em reais fica pendente.
            </span>
          )}
        </p>
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button variant="primary" disabled={busy}
            onClick={() => onConfirm({ ticker: bucket.ticker, date, value: parsed,
              currency })}>
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
      sub="Crie um saldo identificado dentro das suas reservas.">
      <div className="flex flex-col gap-3">
        <label className="flex items-center gap-3 text-[14px]">
          <span className="w-[70px] text-secondary">Nome</span>
          <input value={name} onChange={(e) => setName(e.target.value)}
            placeholder="Viagem"
            className="flex-1 rounded-lg border border-border bg-surface2 px-3 py-2" />
        </label>
        <label className="flex items-center gap-3 text-[14px]">
          <span className="w-[70px] text-secondary">Saldo</span>
          <input value={value} inputMode="decimal"
            onChange={(e) => setValue(e.target.value)} placeholder="0,00"
            className="tnum flex-1 rounded-lg border border-border bg-surface2 px-3
              py-2 text-right" />
        </label>
        {ticker && <p className="text-[13px] text-subtle">Identificador: {ticker}</p>}
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
  const groups = groupsOf(data)
  const pending = (data.pending?.buckets) || {}
  const reconciliations = buildBucketReconciliations({
    accounts: data.accounts, positions: data.positions, reports: pending,
  })

  if (!groups.length) {
    return (
      <div className="flex flex-col gap-6">
        <InvestmentPageHeader eyebrow="Reservas e saldo"
          title="Dinheiro fora da estratégia"
          description="Acompanhe valores reservados, saldos livres e recursos que ainda serão transformados em posições." />
        <Card><Empty>Nenhuma reserva ou saldo separado da estratégia.</Empty></Card>
      </div>
    )
  }

  const updateBalance = async ({ ticker, date, value, currency }) => {
    await onApply({ balances: [{ ticker, date, value, currency }] })
    setUpdating(null)
  }
  const createBucket = async ({ asset, balance }) => {
    await onApply({ assets: [asset], balances: [balance] })
    setCreating(null)
  }

  return (
    <div className="flex flex-col gap-6">
      <InvestmentPageHeader eyebrow="Reservas e saldo"
        title="Dinheiro fora da estratégia"
        description="Acompanhe valores reservados, saldos livres e recursos que ainda serão transformados em posições." />

      {groups.map(({ role, title, hint, rows, accounts }) => {
        const total = rows.reduce((sum, row) => sum + row.value, 0)
        return (
          <Card key={role}>
            <InvestmentCardHeader title={title} description={hint}
              right={(
                <div className="flex flex-wrap items-center gap-4">
                  <div className="text-right">
                    <p className="text-[13px] text-subtle">Total</p>
                    <p className="tnum mt-1 text-[20px] font-bold text-strong">
                      <Money value={total} /></p>
                  </div>
                  {role === 'reserved' && (
                    <Button variant="ghost"
                      onClick={() => setCreating({ accountId: rows[0]?.account,
                        node: rows[0]?.node })}>
                      <Plus className="size-4" /> Nova caixinha
                    </Button>
                  )}
                </div>
              )} />
            <div className="grid gap-3 px-5 pb-5 sm:grid-cols-2 sm:px-6
              sm:pb-6 xl:grid-cols-3">
              {rows.map((row) => (
                <button key={row.ticker} onClick={() => setUpdating(row)}
                  className="flex min-h-[112px] flex-col justify-between rounded-2xl
                    border border-border bg-surface2/40 p-4 text-left
                    transition hover:border-brand/40 hover:bg-surface2/70">
                  <div>
                    <p className="text-[16px] font-bold text-strong">{row.name}</p>
                    <p className="mt-1 text-[13px] text-subtle">
                      {row.price_source === 'pluggy' ? 'sincronizado' : (
                        row.last_balance_date
                          ? `atualizado em ${row.last_balance_date}`
                          : 'sem atualização')}
                      {row.income > 0 && ` · rendeu ${brl(row.income)}`}
                      {accounts[row.account] && ` · ${accounts[row.account].name}`}
                    </p>
                  </div>
                  <span className="tnum mt-5 text-[19px] font-bold text-brand-soft">
                    <Money value={row.value} />
                    {row.currency && row.currency !== 'BRL' && (
                      <span className="ml-2 text-[13px] font-semibold text-faint">
                        {money(row.native_value, row.currency)}</span>
                    )}</span>
                </button>
              ))}
            </div>
          </Card>
        )
      })}

      {reconciliations.length > 0 && (
        <Card>
          <InvestmentCardHeader title="Conciliação com instituições"
            description="Compara o total informado pela instituição com os saldos que você separou dentro dela." />
          <div className="grid gap-3 px-5 pb-5 sm:px-6 sm:pb-6">
            {reconciliations.map((reconciliation) => {
              const matched = Math.abs(reconciliation.difference) <= 0.01
              return (
                <div key={reconciliation.accountId}
                  className="rounded-2xl border border-border bg-surface2/40 p-4">
                  <div className="flex flex-col justify-between gap-4 sm:flex-row
                    sm:items-center">
                    <div>
                      <p className="text-[16px] font-bold text-strong">
                        {reconciliation.accountName}</p>
                      <div className="mt-3 flex flex-wrap gap-x-8 gap-y-3">
                        <div>
                          <p className="text-[13px] text-subtle">Na instituição</p>
                          <p className="tnum mt-1 text-[16px] font-semibold text-strong">
                            <Money value={reconciliation.total} /></p>
                        </div>
                        <div>
                          <p className="text-[13px] text-subtle">Saldos separados</p>
                          <p className="tnum mt-1 text-[16px] font-semibold text-strong">
                            <Money value={reconciliation.registered} /></p>
                        </div>
                      </div>
                    </div>
                    {matched ? (
                      <p className="flex items-center gap-2 text-[14px] font-semibold
                        text-projected">
                        <CheckCircle2 className="size-5 shrink-0" />
                        Valores conferidos
                      </p>
                    ) : (
                      <p className={`flex max-w-sm items-start gap-2 text-[14px]
                        font-semibold ${reconciliation.difference > 0
                          ? 'text-attention' : 'text-red'}`}>
                        <TriangleAlert className="mt-0.5 size-5 shrink-0" />
                        {reconciliation.difference > 0
                          ? `${brl(reconciliation.difference)} ainda não foram distribuídos entre os saldos.`
                          : `Os saldos separados excedem o total em ${brl(-reconciliation.difference)}.`}
                      </p>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </Card>
      )}

      <div className="flex items-start gap-3 rounded-2xl border border-border
        bg-surface2/35 px-5 py-4 text-[14px] leading-5 text-secondary">
        <PiggyBank className="mt-0.5 size-5 shrink-0 text-brand" />
        <p>Esses valores aparecem no patrimônio, mas ficam separados das sugestões
          automáticas de aporte.</p>
      </div>

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
