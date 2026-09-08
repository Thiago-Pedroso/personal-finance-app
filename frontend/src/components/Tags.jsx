import { useMemo, useState } from 'react'
import { ArrowRight, Tags as TagsIcon } from 'lucide-react'
import { Card, CardHead, Button, Empty } from './ui/primitives.jsx'
import { HBars, TrendBars } from './charts.jsx'
import { inputCls } from './ui/MultiSelect.jsx'
import { useDrill } from '../lib/useDrill.jsx'
import { brl, monthLabel, monthShortY } from '../lib/format.js'
import { SensitiveAmount } from './ui/SensitiveValue.jsx'

function createSummary(name) {
  return {
    name, income: 0, expense: 0, count: 0,
    outsideIncome: 0, outsideExpense: 0, categories: {}, months: {},
  }
}

function addAmount(summary, transaction, amount, category, treatments) {
  const month = transaction.date.slice(0, 7)
  const monthly = summary.months[month] || (summary.months[month] = {
    income: 0, expense: 0,
  })
  const treatment = treatments?.[category] || 'fluxo'
  if (treatment !== 'fluxo') {
    if (amount >= 0) summary.outsideIncome += amount
    else summary.outsideExpense += -amount
    return
  }
  const categorySummary = summary.categories[category]
    || (summary.categories[category] = { income: 0, expense: 0 })
  if (amount >= 0) {
    summary.income += amount
    monthly.income += amount
    categorySummary.income += amount
  } else {
    summary.expense += -amount
    monthly.expense += -amount
    categorySummary.expense += -amount
  }
}

function summarizeTags(transactions, treatments) {
  const summaries = {}
  for (const transaction of transactions) {
    if (transaction.excluded || !(transaction.tags || []).length) continue
    const parts = transaction.splits?.length
      ? transaction.splits
      : [{ amount: transaction.signed_amount,
          category: transaction.category || 'Outros' }]
    for (const tag of transaction.tags) {
      const summary = summaries[tag] || (summaries[tag] = createSummary(tag))
      summary.count += 1
      for (const part of parts) {
        addAmount(summary, transaction, part.amount,
          part.category || 'Outros', treatments)
      }
    }
  }
  return Object.values(summaries).sort((left, right) =>
    right.expense - left.expense || left.name.localeCompare(right.name, 'pt-BR'))
}

export function Tags({ dash, mdata, period }) {
  const drill = useDrill()
  const summaries = useMemo(() => summarizeTags(
    mdata.transactions || [], dash.treatments || {}),
  [mdata.transactions, dash.treatments])
  const [selectedTag, setSelectedTag] = useState('')
  const selected = summaries.find((summary) => summary.name === selectedTag)
    || summaries[0]

  if (!summaries.length) {
    return (
      <Card>
        <Empty>Nenhuma tag foi usada neste período.</Empty>
      </Card>
    )
  }

  const incomeDominant = selected.income > selected.expense
  const categoryItems = Object.entries(selected.categories)
    .map(([label, values]) => ({
      label,
      value: incomeDominant ? values.income : values.expense,
    }))
    .filter((item) => item.value > 0)
    .sort((left, right) => right.value - left.value)
  const trend = Object.entries(selected.months)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([month, values]) => ({
      lbl: monthShortY(month),
      value: incomeDominant ? values.income : values.expense,
    }))
  const outsideTotal = selected.outsideIncome + selected.outsideExpense

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 pt-4">
          <div>
            <h2 className="flex items-center gap-2 text-[16px] font-semibold">
              <TagsIcon className="size-4 text-brand" /> Análise por tags
            </h2>
            <p className="mt-1 text-[12px] text-faint">
              {monthLabel(period)} · tags podem se sobrepor
            </p>
          </div>
          <div className="flex items-center gap-2">
            <select value={selected.name}
              onChange={(event) => setSelectedTag(event.target.value)}
              className={inputCls()}>
              {summaries.map((summary) => (
                <option key={summary.name} value={summary.name}>{summary.name}</option>
              ))}
            </select>
            <Button onClick={() => drill?.drill(
              `${selected.name} · ${monthLabel(period)}`, { tags: [selected.name] })}>
              Ver lançamentos <ArrowRight className="size-4" />
            </Button>
          </div>
        </div>
        <div className="grid gap-3 px-5 pb-5 pt-4 sm:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-xl border border-border bg-surface2/50 p-3">
            <div className="text-[11px] uppercase tracking-wide text-faint">Gastos</div>
            <div className="mt-1 text-[20px] font-bold text-red tnum">
              <SensitiveAmount>{brl(selected.expense)}</SensitiveAmount>
            </div>
          </div>
          <div className="rounded-xl border border-border bg-surface2/50 p-3">
            <div className="text-[11px] uppercase tracking-wide text-faint">Receitas</div>
            <div className="mt-1 text-[20px] font-bold text-green tnum">
              <SensitiveAmount>{brl(selected.income)}</SensitiveAmount>
            </div>
          </div>
          <div className="rounded-xl border border-border bg-surface2/50 p-3">
            <div className="text-[11px] uppercase tracking-wide text-faint">Lançamentos</div>
            <div className="mt-1 text-[20px] font-bold tnum">{selected.count}</div>
          </div>
          <div className="rounded-xl border border-border bg-surface2/50 p-3">
            <div className="text-[11px] uppercase tracking-wide text-faint">
              Fora do fluxo
            </div>
            <div className="mt-1 text-[20px] font-bold text-muted tnum">
              <SensitiveAmount>{brl(outsideTotal)}</SensitiveAmount>
            </div>
          </div>
        </div>
        <div className="grid gap-5 border-t border-border px-5 pb-5 pt-4 lg:grid-cols-2">
          <div>
            <p className="mb-2 text-[12px] text-muted">
              {incomeDominant ? 'Receitas' : 'Gastos'} por categoria
            </p>
            <HBars items={categoryItems}
              color={incomeDominant ? '#36c98b' : '#f4685f'}
              byCat
              onClick={(category) => drill?.drill(
                `${selected.name} · ${category}`,
                { tags: [selected.name], cats: [category] })} />
          </div>
          <div>
            <p className="mb-2 text-[12px] text-muted">
              {incomeDominant ? 'Receitas' : 'Gastos'} por mês
            </p>
            <TrendBars data={trend}
              color={incomeDominant ? '#36c98b' : '#f4685f'} />
          </div>
        </div>
      </Card>

      <Card>
        <CardHead title="Tags usadas no período"
          sub="Os totais se sobrepõem quando um lançamento possui mais de uma tag" />
        <div className="grid gap-3 px-5 pb-5 sm:grid-cols-2 xl:grid-cols-3">
          {summaries.map((summary) => (
            <button key={summary.name} onClick={() => setSelectedTag(summary.name)}
              className={`rounded-xl border p-3 text-left transition ${
                summary.name === selected.name
                  ? 'border-brand/50 bg-brand/10'
                  : 'border-border bg-surface2/40 hover:border-faint'}`}>
              <div className="font-semibold">{summary.name}</div>
              <div className="mt-2 flex justify-between text-[12px] text-muted">
                <span>{summary.count} lançamento(s)</span>
                <span className="text-red tnum">
                  <SensitiveAmount>{brl(summary.expense)}</SensitiveAmount>
                </span>
              </div>
            </button>
          ))}
        </div>
      </Card>
    </div>
  )
}
