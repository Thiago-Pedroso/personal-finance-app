import { useMemo, useState } from 'react'

import { brl } from '../../lib/format.js'
import { buildPlan } from '../../lib/investPlan.js'
import { Modal } from '../ui/Modal.jsx'
import { Button, Card, CardHead } from '../ui/primitives.jsx'
import { Money, pct, signedPct } from './shared.jsx'

const MODES = [['spread', 'Distribuir'], ['focus', 'Concentrar']]

// Grupos de irmãos da árvore: cada grupo é uma decisão que soma 100% entre si, que é
// como a política foi pensada desde a planilha.
function groupsOf(policy) {
  const groups = new Map()
  policy.filter((node) => node.counts).forEach((node) => {
    const key = node.parent || ''
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(node)
  })
  return [...groups.entries()]
    .map(([parent, nodes]) => ({
      parent,
      name: policy.find((node) => node.node === parent)?.name || 'Carteira',
      nodes,
    }))
    .filter((group) => group.nodes.length > 1)
}

function RegisterModal({ orders, onClose, onConfirm, busy }) {
  const [rows, setRows] = useState(() => orders.map((order) => ({
    ...order, priceInput: order.price ? String(order.price.toFixed(2)) : '',
    quantityInput: order.quantity ? String(order.quantity) : '',
    amountInput: order.amount.toFixed(2),
    date: new Date().toISOString().slice(0, 10),
  })))
  const set = (index, field, value) => setRows((current) =>
    current.map((row, position) => (position === index ? { ...row, [field]: value } : row)))

  const trades = rows.map((row) => ({
    date: row.date, ticker: row.ticker, side: 'BUY', account: row.account,
    quantity: Number(String(row.quantityInput).replace(',', '.')) || 0,
    price: Number(String(row.priceInput).replace(',', '.'))
      || Number(String(row.amountInput).replace(',', '.')) || 0,
    source: 'plan',
  }))

  return (
    <Modal open onOpenChange={(next) => !next && onClose()} width="max-w-2xl"
      title="Registrar as ordens executadas">
      <div className="flex flex-col gap-3">
        <p className="text-[13px] text-muted">
          Os preços vêm da cotação como rascunho. Corrija com o que a corretora executou
          antes de gravar.
        </p>
        {rows.map((row, index) => (
          <div key={row.ticker} className="grid grid-cols-[1fr_auto] items-center gap-3
            rounded-xl border border-border bg-surface2/40 px-3 py-2 sm:grid-cols-4">
            <span className="text-[13px] font-semibold">{row.ticker}</span>
            <input value={row.date} onChange={(e) => set(index, 'date', e.target.value)}
              className="rounded-lg border border-border bg-surface2 px-2 py-1
                text-[13px]" />
            <input value={row.quantityInput} inputMode="decimal"
              onChange={(e) => set(index, 'quantityInput', e.target.value)}
              placeholder="qtd"
              className="tnum rounded-lg border border-border bg-surface2 px-2 py-1
                text-right text-[13px]" />
            <input value={row.priceInput} inputMode="decimal"
              onChange={(e) => set(index, 'priceInput', e.target.value)}
              placeholder={row.price ? 'preço' : 'valor'}
              className="tnum rounded-lg border border-border bg-surface2 px-2 py-1
                text-right text-[13px]" />
          </div>
        ))}
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button variant="primary" disabled={busy}
            onClick={() => onConfirm(trades)}>Gravar movimentações</Button>
        </div>
      </div>
    </Modal>
  )
}

export function Aporte({ data, onApply, busy }) {
  const [amount, setAmount] = useState(() => String(data.contribution || 1000))
  const [mode, setMode] = useState('spread')
  const [policy, setPolicy] = useState(() => Object.fromEntries(
    data.policy.map((node) => [node.node, node.target_pct])))
  const [registering, setRegistering] = useState(false)

  const groups = useMemo(() => groupsOf(data.policy), [data.policy])
  const dirty = data.policy.some((node) =>
    Math.abs((policy[node.node] ?? 0) - node.target_pct) > 1e-9)

  // Recalcula a alocação com os alvos da tela: mudar um slider muda o peso da folha, e
  // é o mesmo motor do Python que decide o resto.
  const allocation = useMemo(() => {
    const weightOf = (node) => {
      let total = 1
      let current = data.policy.find((item) => item.node === node)
      while (current) {
        total *= policy[current.node] ?? current.target_pct
        current = current.parent
          ? data.policy.find((item) => item.node === current.parent) : null
      }
      return total
    }
    const base = data.allocation.filter((item) => item.in_totals)
      .reduce((sum, item) => sum + item.value, 0)
    return data.allocation.map((item) => {
      const target = item.in_totals ? weightOf(item.node) : 0
      const real = base ? item.value / base : 0
      return { ...item, target_pct: target,
        drift: item.in_totals ? real - target : 0 }
    })
  }, [data.allocation, data.policy, policy])

  const positions = useMemo(() => Object.fromEntries(
    data.positions.map((position) => [position.ticker, position])), [data.positions])
  const assets = useMemo(() => data.positions.map((position) => ({
    ticker: position.ticker, name: position.name, node: position.node,
    target_pct: position.target_pct, lot_size: position.lot_size,
    valuation: position.valuation, account: position.account, active: true,
  })), [data.positions])

  const plan = useMemo(() => buildPlan({
    allocation, assets, positions,
    contribution: Number(String(amount).replace(',', '.')) || 0, mode,
  }), [allocation, assets, positions, amount, mode])

  const savePolicy = () => onApply({
    policy: data.policy.map((node) => ({ ...node, target_pct: policy[node.node] })),
  })
  const register = async (trades) => {
    await onApply({ trades })
    setRegistering(false)
  }

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHead title="Aporte"
          sub="nada aqui é gravado: a simulação vive na tela até você registrar" />
        <div className="flex flex-wrap items-center gap-3 px-5 pb-5">
          <div className="flex items-center gap-2 rounded-xl border border-border
            bg-surface2 px-3 py-2">
            <span className="text-[13px] text-muted">R$</span>
            <input value={amount} inputMode="decimal"
              onChange={(e) => setAmount(e.target.value)}
              className="tnum w-[120px] bg-transparent text-[15px] font-semibold
                outline-none" />
          </div>
          <div className="flex gap-1 rounded-xl border border-border bg-surface2/70 p-1">
            {MODES.map(([key, label]) => (
              <button key={key} onClick={() => setMode(key)}
                className={`rounded-lg px-3 py-1.5 text-[12.5px] font-semibold transition
                  ${mode === key ? 'bg-brand text-white' : 'text-muted hover:text-text'}`}>
                {label}
              </button>
            ))}
          </div>
          <span className="text-[12px] text-faint">
            {mode === 'spread'
              ? 'proporcional ao que falta em cada classe'
              : 'tudo no maior buraco'}
          </span>
        </div>
      </Card>

      <Card>
        <CardHead title="Política de alocação"
          sub="cada grupo é uma decisão que soma 100% entre si"
          right={dirty ? (
            <span className="flex gap-2">
              <Button variant="ghost" onClick={() => setPolicy(Object.fromEntries(
                data.policy.map((node) => [node.node, node.target_pct])))}>
                Descartar</Button>
              <Button variant="primary" onClick={savePolicy} disabled={busy}>
                Salvar política</Button>
            </span>
          ) : null} />
        <div className="grid gap-5 px-5 pb-5 sm:grid-cols-2">
          {groups.map((group) => (
            <div key={group.parent} className="flex flex-col gap-2">
              <p className="text-[12px] font-semibold text-faint">{group.name}</p>
              {group.nodes.map((node) => (
                <label key={node.node} className="flex items-center gap-3">
                  <span className="w-[110px] text-[13px]">{node.name}</span>
                  <input type="range" min="0" max="100" step="1"
                    value={Math.round((policy[node.node] ?? 0) * 100)}
                    onChange={(e) => setPolicy((current) => ({
                      ...current, [node.node]: Number(e.target.value) / 100 }))}
                    className="h-1 flex-1 cursor-pointer appearance-none rounded-full
                      bg-surface2 accent-brand" />
                  <span className="tnum w-[46px] text-right text-[12px] text-muted">
                    {pct(policy[node.node] ?? 0, 0)}</span>
                </label>
              ))}
            </div>
          ))}
        </div>
      </Card>

      <Card>
        <CardHead title="Plano"
          sub={`aloca ${brl(plan.allocated)} de ${brl(plan.contribution)}`}
          right={plan.orders.length > 0 && (
            <Button variant="primary" onClick={() => setRegistering(true)}>
              Registrar como movimentações</Button>
          )} />
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="text-[11px] uppercase tracking-wider text-faint">
                <th className="px-5 py-2 text-left font-medium">Ativo</th>
                <th className="px-3 py-2 text-right font-medium">Qtd</th>
                <th className="px-3 py-2 text-right font-medium">Preço</th>
                <th className="px-3 py-2 text-right font-medium">Valor</th>
                <th className="px-5 py-2 text-right font-medium">Desvio da classe</th>
              </tr>
            </thead>
            <tbody>
              {plan.orders.map((order) => {
                const node = plan.nodes.find((item) => item.node === order.node)
                return (
                  <tr key={order.ticker} className="border-t border-border/40">
                    <td className="px-5 py-2 font-semibold">{order.ticker}
                      <span className="ml-2 text-[11px] font-normal text-faint">
                        {node?.name}</span></td>
                    <td className="tnum px-3 py-2 text-right text-muted">
                      {order.quantity ? order.quantity.toLocaleString('pt-BR',
                        { maximumFractionDigits: 8 }) : '—'}</td>
                    <td className="tnum px-3 py-2 text-right text-muted">
                      {order.price ? brl(order.price) : '—'}</td>
                    <td className="tnum px-3 py-2 text-right">
                      <Money value={order.amount} /></td>
                    <td className="tnum px-5 py-2 text-right text-[12px]">
                      <span className="text-muted">{signedPct(node?.drift_before)}</span>
                      <span className="mx-1.5 text-faint">→</span>
                      <span className="text-brand-soft">{signedPct(node?.drift_after)}</span>
                    </td>
                  </tr>
                )
              })}
              {plan.orders.length === 0 && (
                <tr><td colSpan="5" className="px-5 py-8 text-center text-[13px]
                  text-faint">Informe um valor de aporte para ver o plano.</td></tr>
              )}
            </tbody>
          </table>
        </div>
        {plan.leftover > 0.01 && (
          <p className="border-t border-border/60 px-5 py-3 text-[12px] text-faint">
            Sobra {brl(plan.leftover)}
            {plan.blocked_nodes.length > 0
              && `: o que falta em ${plan.blocked_nodes.join(', ')} não cabe num lote inteiro.`}
          </p>
        )}
      </Card>

      {registering && (
        <RegisterModal orders={plan.orders} busy={busy}
          onClose={() => setRegistering(false)} onConfirm={register} />
      )}
    </div>
  )
}
