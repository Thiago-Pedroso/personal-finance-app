import { useMemo, useState } from 'react'

import { brl } from '../../lib/format.js'
import { buildPlan } from '../../lib/investPlan.js'
import { groupPolicyNodes, updateGroupTargets } from '../../lib/investPolicy.js'
import { Modal } from '../ui/Modal.jsx'
import { Button, Card } from '../ui/primitives.jsx'
import { Slider } from '../ui/Slider.jsx'
import { InvestmentCardHeader, InvestmentPageHeader, Money, pct,
  signedPct } from './shared.jsx'

const MODES = [
  ['spread', 'Distribuir', 'Divide o aporte entre as classes abaixo do objetivo.'],
  ['focus', 'Concentrar', 'Direciona o aporte para a classe mais distante do objetivo.'],
]

function BinaryPolicyGroup({ group, values, onChange }) {
  const [firstNode, secondNode] = group.nodes
  const firstValue = values[firstNode.node] ?? firstNode.target_pct
  const secondValue = values[secondNode.node] ?? secondNode.target_pct

  return (
    <div className="rounded-2xl border border-border bg-surface2/45 p-5">
      <p className="mb-5 text-[14px] font-bold text-secondary">{group.name}</p>
      <div className="mb-4 flex items-start justify-between gap-6">
        <div>
          <p className="text-[15px] font-semibold text-strong">{firstNode.name}</p>
          <p className="tnum mt-1 text-[24px] font-bold text-brand-soft">
            {pct(firstValue, 0)}</p>
        </div>
        <div className="text-right">
          <p className="text-[15px] font-semibold text-strong">{secondNode.name}</p>
          <p className="tnum mt-1 text-[24px] font-bold text-brand-soft">
            {pct(secondValue, 0)}</p>
        </div>
      </div>
      <Slider min={0} max={100} step={1} size="large"
        value={Math.round(firstValue * 100)}
        onChange={(value) => onChange(group, firstNode, value / 100)} />
      <p className="mt-4 text-[13px] text-subtle">
        As duas partes permanecem em 100%.</p>
    </div>
  )
}

function MultiplePolicyGroup({ group, values, onChange }) {
  const total = group.nodes.reduce((sum, node) =>
    sum + (values[node.node] ?? node.target_pct), 0)

  return (
    <div className="rounded-2xl border border-border bg-surface2/45 p-5">
      <div className="mb-5 flex items-center justify-between gap-4">
        <p className="text-[14px] font-bold text-secondary">{group.name}</p>
        <span className="tnum text-[13px] font-semibold text-projected">
          Soma {pct(total, 0)}</span>
      </div>
      <div className="flex flex-col gap-5">
        {group.nodes.map((node) => {
          const value = values[node.node] ?? node.target_pct
          return (
            <label key={node.node} className="block">
              <span className="mb-2 flex items-baseline justify-between gap-4">
                <span className="text-[15px] font-semibold text-strong">
                  {node.name}</span>
                <span className="tnum text-[18px] font-bold text-brand-soft">
                  {pct(value, 0)}</span>
              </span>
              <Slider min={0} max={100} step={1} size="large"
                value={Math.round(value * 100)}
                onChange={(nextValue) => onChange(group, node, nextValue / 100)} />
            </label>
          )
        })}
      </div>
      <p className="mt-4 text-[13px] text-subtle">
        As demais opções se ajustam proporcionalmente.</p>
    </div>
  )
}

function PolicyGroup(props) {
  return props.group.nodes.length === 2
    ? <BinaryPolicyGroup {...props} />
    : <MultiplePolicyGroup {...props} />
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
  const savedMode = data.contribution_mode || data.plan?.mode || 'spread'
  const [amount, setAmount] = useState(() => String(data.contribution ?? 0))
  const [mode, setMode] = useState(() => savedMode)
  const [policy, setPolicy] = useState(() => Object.fromEntries(
    data.policy.map((node) => [node.node, node.target_pct])))
  const [registering, setRegistering] = useState(false)

  const parsedAmount = Number(String(amount).replace(',', '.'))
  const validAmount = String(amount).trim() !== ''
    && Number.isFinite(parsedAmount) && parsedAmount >= 0
  const contributionAmount = validAmount ? parsedAmount : 0
  const contributionDirty = validAmount && (
    Math.abs(contributionAmount - (data.contribution ?? 0)) > 0.005
    || mode !== savedMode)
  const groups = useMemo(() => groupPolicyNodes(data.policy), [data.policy])
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
    contribution: contributionAmount, mode,
  }), [allocation, assets, positions, contributionAmount, mode])

  const savePolicy = () => onApply({
    policy: data.policy.map((node) => ({ ...node, target_pct: policy[node.node] })),
  })
  const changePolicyGroup = (group, node, value) => setPolicy((current) =>
    updateGroupTargets(current, group.nodes, node.node, value))
  const saveContribution = () => onApply({
    contribution: contributionAmount, contribution_mode: mode,
  })
  const register = async (trades) => {
    await onApply({ trades })
    setRegistering(false)
  }

  return (
    <div className="flex flex-col gap-6">
      <InvestmentPageHeader eyebrow="Planejamento mensal"
        title="Simule seu próximo aporte"
        description="Ajuste o valor e a política para visualizar como o dinheiro pode ser distribuído entre os ativos."
        status={!validAmount
          ? 'Valor de aporte inválido'
          : contributionDirty
            ? 'Alterações ainda não salvas'
            : contributionAmount > 0
              ? 'Próximo aporte salvo'
              : 'Sem aporte definido'} />

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1.65fr)_minmax(320px,.7fr)]">
        <Card>
          <InvestmentCardHeader title="Política de alocação"
            description="Cada card representa uma decisão da sua própria estratégia."
            info="Os percentuais de cada grupo permanecem em 100%."
            right={dirty ? (
              <span className="flex flex-wrap gap-2">
                <Button variant="ghost" onClick={() => setPolicy(Object.fromEntries(
                  data.policy.map((node) => [node.node, node.target_pct])))}>
                  Descartar</Button>
                <Button variant="primary" onClick={savePolicy} disabled={busy}>
                  Salvar política</Button>
              </span>
            ) : null} />
          <div className="grid gap-4 px-5 pb-5 lg:grid-cols-2 sm:px-6 sm:pb-6">
            {groups.map((group) => (
              <PolicyGroup key={group.parent} group={group} values={policy}
                onChange={changePolicyGroup} />
            ))}
            {groups.length === 0 && (
              <p className="col-span-full py-8 text-center text-[14px] text-subtle">
                Sua política não possui grupos com mais de uma opção.</p>
            )}
          </div>
        </Card>

        <Card className="order-first xl:order-none">
          <InvestmentCardHeader title="Valor do aporte"
            info="O plano muda imediatamente. O registro só acontece ao confirmar as movimentações." />
          <div className="px-5 pb-6 sm:px-6">
            <label htmlFor="contribution-amount"
              className="mb-2 block text-[14px] text-secondary">
              Quanto você quer investir?
            </label>
            <div className="flex min-h-16 items-center gap-2 rounded-2xl border
              border-border bg-surface2 px-4">
              <span className="text-[16px] text-secondary">R$</span>
              <input id="contribution-amount" value={amount} inputMode="decimal"
                onChange={(event) => setAmount(event.target.value)}
                className="tnum min-w-0 flex-1 bg-transparent text-[25px] font-bold
                  outline-none" />
            </div>
            <p className="mb-3 mt-6 text-[14px] text-secondary">
              Estratégia da simulação</p>
            <div className="grid grid-cols-2 gap-2">
              {MODES.map(([key, label]) => (
                <button key={key} onClick={() => setMode(key)} aria-pressed={mode === key}
                  className={`min-h-11 rounded-xl border px-3 text-[14px] font-bold
                    transition ${mode === key
                      ? 'border-brand bg-brand text-white shadow-[0_8px_24px_-12px_#5b9dff]'
                      : 'border-border bg-surface2 text-secondary hover:text-strong'}`}>
                  {label}
                </button>
              ))}
            </div>
            <p className="mt-3 min-h-10 text-[14px] leading-5 text-secondary">
              {MODES.find(([key]) => key === mode)?.[2]}
            </p>
            <Button variant="primary" onClick={saveContribution}
              disabled={!validAmount || !contributionDirty || busy}
              className="mt-4 min-h-11 w-full justify-center text-[14px]">
              {!validAmount || contributionAmount === 0
                ? 'Defina um valor para salvar'
                : contributionDirty
                  ? 'Salvar como próximo aporte'
                  : 'Próximo aporte salvo'}
            </Button>
          </div>
        </Card>
      </div>

      <Card className="overflow-hidden">
        <div className="flex flex-col justify-between gap-5 border-b border-border
          bg-gradient-to-r from-brand/[0.07] to-transparent px-5 py-6
          sm:px-6 lg:flex-row lg:items-center">
          <div>
            <h3 className="text-[24px] font-bold tracking-[-0.025em] text-strong">
              Plano sugerido</h3>
            <p className="mt-1.5 text-[15px] text-secondary">
              Distribuição estimada para o aporte informado.</p>
          </div>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
            <div className="sm:text-right">
              <p className="text-[13px] font-semibold text-secondary">
                Valor que será alocado</p>
              <p className="tnum mt-1 text-[22px] font-bold text-strong">
                <Money value={plan.allocated} />{' '}
                <span className="text-[14px] font-medium text-secondary">
                  de <Money value={plan.contribution} /></span>
              </p>
            </div>
            {plan.orders.length > 0 && (
              <Button variant="primary" className="min-h-11 justify-center text-[14px]"
                onClick={() => setRegistering(true)}>
                Registrar movimentações</Button>
            )}
          </div>
        </div>
        <table className="invest-table invest-responsive-table w-full text-[16px]">
          <thead className="bg-table-head text-[14px] font-bold text-strong">
            <tr className="h-16 border-b border-white/15">
              <th className="px-6 text-left font-bold">Ativo</th>
              <th className="px-3 text-right font-bold">Quantidade</th>
              <th className="px-3 text-right font-bold">Cotação</th>
              <th className="px-3 text-right font-bold">Valor do aporte</th>
              <th className="px-3 text-right font-bold">Desvio atual</th>
              <th className="px-6 text-right font-bold">Após aporte</th>
            </tr>
          </thead>
          <tbody>
            {plan.orders.map((order) => {
              const node = plan.nodes.find((item) => item.node === order.node)
              return (
                <tr key={order.ticker} className="min-h-[76px] border-b border-border/60
                  last:border-0">
                  <td data-primary="true" className="px-6" data-label="Ativo">
                    <p className="font-bold text-strong">{order.ticker}</p>
                    <p className="mt-0.5 text-[14px] text-subtle">{node?.name}</p>
                  </td>
                  <td data-label="Quantidade"
                    className="tnum px-3 text-right font-semibold text-strong">
                    {order.quantity ? order.quantity.toLocaleString('pt-BR',
                      { maximumFractionDigits: 8 }) : '—'}</td>
                  <td data-label="Cotação"
                    className="tnum px-3 text-right font-semibold text-secondary">
                    {order.price ? brl(order.price) : '—'}</td>
                  <td data-label="Valor do aporte"
                    className="tnum px-3 text-right font-semibold text-brand-soft">
                    <Money value={order.amount} /></td>
                  <td data-label="Desvio atual"
                    className="tnum px-3 text-right font-semibold text-attention">
                    {signedPct(node?.drift_before)}</td>
                  <td data-label="Após aporte"
                    className="tnum px-6 text-right font-semibold text-projected">
                    {signedPct(node?.drift_after)}</td>
                </tr>
              )
            })}
            {plan.orders.length === 0 && (
              <tr><td colSpan="6" data-empty="true"
                className="px-6 py-12 text-center text-[14px] text-subtle">
                Informe um valor de aporte para ver o plano.</td></tr>
            )}
          </tbody>
        </table>
        {plan.leftover > 0.01 && (
          <p className="border-t border-border/60 px-5 py-4 text-[14px]
            text-secondary sm:px-6">
            Restam {brl(plan.leftover)} livres
            {plan.blocked_nodes.length > 0
              && ` porque o valor de ${plan.blocked_nodes.join(', ')} não completa um lote.`}
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
