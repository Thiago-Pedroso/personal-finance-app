import { useEffect, useMemo, useState } from 'react'
import { Card, Empty, Skeleton } from './ui/primitives.jsx'
import { inputCls } from './ui/MultiSelect.jsx'
import { SensitiveAmount } from './ui/SensitiveValue.jsx'
import { CategoryTag } from '../lib/categories.jsx'
import { getRules } from '../lib/api.js'
import { brl, fullDate, monthLabel } from '../lib/format.js'
import { useDrill } from '../lib/useDrill.jsx'
import { Bot, EyeOff, Search, StickyNote } from 'lucide-react'

const FIELD_LABELS = {
  description: 'Descrição', merchant_name: 'Lojista', counterparty: 'Contraparte',
}
const MATCH_LABELS = {
  contains: 'contém', exact: 'igual a', startswith: 'começa com', regex: 'regex',
}
const TYPE_LABELS = { DEBIT: 'Débito', CREDIT: 'Crédito' }

function Chip({ tone = 'muted', children }) {
  const tones = {
    muted: 'border-border bg-surface2 text-muted',
    amber: 'border-amber/40 bg-amber/10 text-amber',
  }
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-1.5
      py-px text-[11px] font-medium ${tones[tone]}`}>{children}</span>
  )
}

function AmountChip({ min, max }) {
  if (min == null && max == null) return null
  const money = (value) => <SensitiveAmount>{brl(value)}</SensitiveAmount>
  if (min != null && max != null) {
    return <Chip>{min === max
      ? <>igual a {money(min)}</>
      : <>entre {money(min)} e {money(max)}</>}</Chip>
  }
  return <Chip>{min != null ? <>a partir de {money(min)}</> : <>até {money(max)}</>}</Chip>
}

function ruleText(rule) {
  return [rule.value, rule.category, rule.subcategory, rule.note, rule.instruction]
    .filter(Boolean).join(' ').toLowerCase()
}

export function Rules({ dash, mdata, period }) {
  const drill = useDrill()
  const [rules, setRules] = useState(null)
  const [error, setError] = useState(null)
  const [query, setQuery] = useState('')

  useEffect(() => {
    let alive = true
    getRules()
      .then((data) => alive && setRules(data.rules || []))
      .catch((e) => alive && setError(e.message))
    return () => { alive = false }
  }, [dash?.generated_at])

  const periodCounts = useMemo(() => {
    const counts = {}
    for (const transaction of mdata.transactions || []) {
      if (transaction.category_source !== 'rule' || !transaction.rule_id) continue
      counts[transaction.rule_id] = (counts[transaction.rule_id] || 0) + 1
    }
    return counts
  }, [mdata])

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return (rules || []).filter((rule) => !needle || ruleText(rule).includes(needle))
  }, [rules, query])

  if (error) return <Card className="p-5"><Empty>{error}</Empty></Card>
  if (!rules) return <Skeleton className="h-64" />

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
        <div>
          <h2 className="text-[15px] font-semibold">Regras ({rules.length})</h2>
          <p className="mt-0.5 text-[12px] text-faint">
            Na ordem em que são testadas. Contagem de {monthLabel(period)} e do
            histórico inteiro.
          </p>
        </div>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-faint" />
          <input value={query} onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar…" className={inputCls('w-56 pl-9')} />
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="border-y border-border text-left text-[11px] font-semibold
              uppercase tracking-wide text-faint">
              <th className="px-5 py-3">#</th>
              <th className="px-5 py-3">Critério</th>
              <th className="px-5 py-3">Categoria</th>
              <th className="px-5 py-3 text-right">Lanç.</th>
              <th className="px-5 py-3 text-right">Último</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((rule) => {
              const inPeriod = periodCounts[rule.id] || 0
              const unused = rule.count === 0
              return (
                <tr key={rule.id} className={`border-b border-border/60 align-top
                  ${unused ? 'opacity-50' : ''}`}>
                  <td className="tnum px-5 py-3 text-faint">{rule.priority}</td>
                  <td className="max-w-[420px] px-5 py-3">
                    <div>
                      <span className="text-muted">
                        {FIELD_LABELS[rule.field] || rule.field}{' '}
                        {MATCH_LABELS[rule.match] || rule.match}{' '}
                      </span>
                      <span className="break-words font-medium">“{rule.value}”</span>
                    </div>
                    {(rule.amount_abs_min != null || rule.amount_abs_max != null
                      || rule.type || rule.excluded) && (
                      <div className="mt-1 flex flex-wrap gap-1">
                        <AmountChip min={rule.amount_abs_min} max={rule.amount_abs_max} />
                        {rule.type && <Chip>{TYPE_LABELS[rule.type] || rule.type}</Chip>}
                        {rule.excluded && (
                          <Chip tone="amber"><EyeOff className="size-3" />rasura</Chip>
                        )}
                      </div>
                    )}
                    {rule.note && (
                      <div title={rule.propagate_note
                        ? 'Nota gravada em toda transação que casar'
                        : 'Nota interna da regra'}
                        className={`mt-1 flex items-center gap-1.5 text-[12px] ${
                          rule.propagate_note ? 'text-amber' : 'text-faint'}`}>
                        <StickyNote className="size-3.5 shrink-0" />
                        <span className="line-clamp-1">{rule.note}</span>
                      </div>
                    )}
                    {rule.instruction && (
                      <div title={rule.instruction}
                        className="mt-1 flex items-center gap-1.5 text-[12px] text-blue">
                        <Bot className="size-3.5 shrink-0" />
                        <span className="line-clamp-1">{rule.instruction}</span>
                      </div>
                    )}
                  </td>
                  <td className="px-5 py-3">
                    <CategoryTag size="xs" category={rule.category}
                      subcategory={rule.subcategory} />
                  </td>
                  <td className="whitespace-nowrap px-5 py-3 text-right">
                    {inPeriod > 0 ? (
                      <button type="button"
                        onClick={() => drill?.drill(
                          `Regra ${rule.id}: ${rule.value} (${monthLabel(period)})`,
                          { rule: rule.id })}
                        className="tnum font-semibold text-brand hover:underline">
                        {inPeriod}
                      </button>
                    ) : <span className="tnum text-faint">0</span>}
                    <div className="tnum text-[11px] text-faint">{rule.count} total</div>
                  </td>
                  <td className="tnum whitespace-nowrap px-5 py-3 text-right text-faint">
                    {rule.last_date ? fullDate(rule.last_date) : '-'}
                  </td>
                </tr>
              )
            })}
            {visible.length === 0 && (
              <tr><td colSpan={5} className="py-14 text-center text-faint">
                Nenhuma regra encontrada.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </Card>
  )
}
