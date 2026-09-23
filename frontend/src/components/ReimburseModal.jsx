import { useMemo, useState } from 'react'
import { Modal } from './ui/Modal.jsx'
import { Button } from './ui/primitives.jsx'
import { inputCls } from './ui/MultiSelect.jsx'
import { useToast } from './ui/Toast.jsx'
import { brl, dayMonth } from '../lib/format.js'
import { ArrowRight, Plus, Trash2 } from 'lucide-react'

const round = (value) => Math.round(value * 100) / 100

// cada lançamento (ou parte de split) vira um item com o quanto ainda dá para abater
function itemsOf(transactions) {
  return transactions.flatMap((transaction) => {
    const info = transaction.reimbursed
    const parts = transaction.splits?.length
      ? transaction.splits.map((part, index) => ({
        part: index, amount: part.amount, used: info?.parts?.[index] || 0,
        label: `${transaction.description} (parte ${index + 1}, ${part.category || 'sem categoria'})`,
      }))
      : [{ part: null, amount: transaction.signed_amount, used: info?.amount || 0,
        label: transaction.description }]
    return parts.map((part) => ({
      ...part, id: transaction.id, date: transaction.date,
      key: `${transaction.id}:${part.part ?? ''}`,
      available: round(Math.abs(part.amount) - part.used),
    }))
  }).filter((item) => item.amount !== 0 && item.available > 0)
}

// pareia saídas e entradas por data, abatendo o máximo possível
function greedyPairs(credits, debits) {
  const left = Object.fromEntries(credits.map((item) => [item.key, item.available]))
  const pairs = []
  for (const debit of [...debits].sort((a, b) => a.date.localeCompare(b.date))) {
    let need = debit.available
    for (const credit of [...credits].sort((a, b) => a.date.localeCompare(b.date))) {
      if (need <= 0) break
      const amount = round(Math.min(need, left[credit.key]))
      if (amount <= 0) continue
      pairs.push({ credit: credit.key, debit: debit.key, amount: String(amount) })
      left[credit.key] = round(left[credit.key] - amount)
      need = round(need - amount)
    }
  }
  return pairs
}

export function ReimburseModal({ open, onClose, txns, saveEdit }) {
  const toast = useToast()
  const items = useMemo(() => itemsOf(txns), [txns])
  const credits = items.filter((item) => item.amount > 0)
  const debits = items.filter((item) => item.amount < 0)
  const byKey = Object.fromEntries(items.map((item) => [item.key, item]))
  const [pairs, setPairs] = useState(() => greedyPairs(credits, debits))
  const [note, setNote] = useState('')

  const usedBy = {}
  for (const pair of pairs) {
    const amount = +pair.amount || 0
    usedBy[pair.credit] = (usedBy[pair.credit] || 0) + amount
    usedBy[pair.debit] = (usedBy[pair.debit] || 0) + amount
  }
  const leftOf = (item) => round(item.available - (usedBy[item.key] || 0))
  const valid = pairs.length > 0
    && pairs.every((pair) => +pair.amount > 0 && byKey[pair.credit] && byKey[pair.debit])
    && items.every((item) => leftOf(item) >= -0.005)

  const setPair = (index, field, value) => setPairs((current) =>
    current.map((pair, position) => position === index ? { ...pair, [field]: value } : pair))
  const addPair = () => setPairs((current) => [...current,
    { credit: credits[0]?.key, debit: debits[0]?.key, amount: '' }])

  async function save() {
    const links = pairs.map((pair) => {
      const credit = byKey[pair.credit]
      const debit = byKey[pair.debit]
      return { credit_id: credit.id, credit_part: credit.part,
        debit_id: debit.id, debit_part: debit.part, amount: round(+pair.amount) }
    })
    const labels = Object.fromEntries(txns.map((transaction) =>
      [transaction.id, { description: transaction.description, date: transaction.date }]))
    try {
      await saveEdit({ mode: 'reimburse', ids: txns.map((transaction) => transaction.id),
        links, note: note.trim() || null, labels })
      toast(`${links.length} abatimento(s) registrado(s).`, 'success')
      onClose()
    } catch (e) {
      toast('Erro ao abater: ' + e.message, 'error', 7000)
    }
  }

  const option = (item) => (
    <option key={item.key} value={item.key}>
      {dayMonth(item.date)} {item.label} ({brl(item.available)})
    </option>
  )
  const summary = (title, list, tone) => (
    <div className="rounded-xl border border-border bg-surface2/50 p-2.5">
      <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-faint">
        {title}</div>
      {list.map((item) => (
        <div key={item.key} className="flex justify-between gap-3 py-0.5 text-[12px]">
          <span className="truncate">
            <span className="tnum mr-2 text-faint">{dayMonth(item.date)}</span>
            {item.label}
          </span>
          <span className={`tnum shrink-0 ${leftOf(item) < -0.005 ? 'text-red' : tone}`}>
            sobra {brl(leftOf(item))}
          </span>
        </div>
      ))}
    </div>
  )

  return (
    <Modal open={open} onOpenChange={(value) => !value && onClose()} width="max-w-2xl"
      title="Abater lançamentos"
      sub="Registre quem abate quem, total ou parcialmente."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button variant="primary" disabled={!valid} onClick={save}>Abater</Button>
        </>
      }>
      <div className="grid gap-2 sm:grid-cols-2">
        {summary('Entradas', credits, 'text-green')}
        {summary('Saídas', debits, 'text-red')}
      </div>

      <div className="mt-4 text-[12px] font-semibold text-muted">Quem abate quem</div>
      <div className="mt-2 flex flex-col gap-2">
        {pairs.map((pair, index) => (
          <div key={index} className="flex items-center gap-2">
            <select value={pair.credit} onChange={(e) => setPair(index, 'credit', e.target.value)}
              className={inputCls('min-w-0 flex-1')}>{credits.map(option)}</select>
            <ArrowRight className="size-4 shrink-0 text-faint" />
            <select value={pair.debit} onChange={(e) => setPair(index, 'debit', e.target.value)}
              className={inputCls('min-w-0 flex-1')}>{debits.map(option)}</select>
            <input type="number" step="0.01" min="0" value={pair.amount}
              onChange={(e) => setPair(index, 'amount', e.target.value)}
              className={inputCls('tnum w-28')} />
            <button onClick={() => setPairs((current) =>
              current.filter((_, position) => position !== index))}
              className="rounded-lg px-1.5 text-muted hover:text-red">
              <Trash2 className="size-4" />
            </button>
          </div>
        ))}
      </div>
      <Button variant="ghost" className="mt-2" onClick={addPair}>
        <Plus className="size-4" /> par
      </Button>

      <label className="mt-4 block text-[12px] text-muted">
        Nota <span className="text-faint">(opcional, fica no vínculo)</span>
        <input value={note} onChange={(e) => setNote(e.target.value)}
          placeholder="Ex.: reembolso da FUNAPE pelo café do projeto"
          className={inputCls('mt-1 w-full')} />
      </label>
    </Modal>
  )
}
