import { useState } from 'react'
import { ArrowRight, Gift, HandCoins, UserRound } from 'lucide-react'
import { brl, fullDate, monthShortY, signedBrl } from '../lib/format.js'
import { Badge, Button, Card, CardHead } from './ui/primitives.jsx'
import { SensitiveAmount } from './ui/SensitiveValue.jsx'
import { HBars, TrendBars } from './charts.jsx'

// Pessoas = beneficiários (`person`): para quem foi o dinheiro. As pendências de
// "Com quem" (`settle_with`) do mesmo nome aparecem junto, como o que está em aberto.
// O resumo vem pronto do relatório (finance/people.py) e cobre o histórico inteiro.

function Stat({ label, value, tone = 'text-strong', icon: Icon }) {
  return (
    <div className="min-w-0 rounded-xl border border-border/70 bg-bg/30 px-3.5 py-3">
      <p className="flex items-center gap-1.5 text-[11.5px] font-medium uppercase
        tracking-wider text-faint">{Icon && <Icon className="size-3.5" />}{label}</p>
      <p className={`mt-1 truncate text-[15px] font-bold tnum sm:text-[18px] ${tone}`}>
        {value}</p>
    </div>
  )
}

function PersonList({ people, summary, selected, onSelect }) {
  return (
    <ul className="flex flex-col gap-1.5">
      {people.map((name) => {
        const p = summary[name]
        const active = name === selected
        return (
          <li key={name}>
            <button onClick={() => onSelect(name)} aria-pressed={active}
              className={`flex w-full items-center gap-3 rounded-xl border px-3 py-2.5
                text-left transition ${active
                  ? 'border-brand/40 bg-brand/10'
                  : 'border-border bg-surface/60 hover:border-faint'}`}>
              <span className="grid size-9 shrink-0 place-items-center rounded-full
                bg-violet/15 text-[13px] font-bold text-violet">
                {name.slice(0, 1).toUpperCase()}</span>
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline justify-between gap-2">
                  <span className="truncate text-[14px] font-semibold">{name}</span>
                  <span className="shrink-0 text-[11.5px] text-faint">{p.count} lanç.</span>
                </span>
                <span className="mt-0.5 flex flex-wrap gap-x-3 text-[12.5px]">
                  <SensitiveAmount className="tnum font-semibold text-red">
                    −{brl(p.sent)}</SensitiveAmount>
                  {p.received > 0 && <SensitiveAmount className="tnum text-green">
                    +{brl(p.received)}</SensitiveAmount>}
                </span>
              </span>
            </button>
          </li>
        )
      })}
    </ul>
  )
}

function PersonDetail({ p, goTxns }) {
  const months = p.by_month.slice(-12).map((m) => ({ lbl: monthShortY(m.month),
    value: m.sent }))
  const cats = p.by_category.map((c) => ({ label: c.category, value: c.sent }))
  const open = p.receivable + p.payable
  const loan = p.loan_balance
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <Card>
        <CardHead title={p.name}
          sub="Tudo que foi marcado como sendo para esta pessoa, no histórico inteiro"
          right={goTxns && (
            <Button variant="ghost"
              onClick={() => goTxns(p.name, p.transactions[0]?.date?.slice(0, 7))}
              title="Abre Transações filtrado por esta pessoa, no mês do último lançamento">
              <span className="hidden sm:inline">Transações</span>
              <ArrowRight className="size-4" /></Button>)} />
        <div className="grid grid-cols-2 gap-2.5 px-5 pb-5 xl:grid-cols-4">
          <Stat label="Enviado" icon={UserRound} tone="text-red"
            value={<SensitiveAmount>{brl(p.sent)}</SensitiveAmount>} />
          <Stat label="Recebido" tone="text-green"
            value={<SensitiveAmount>{brl(p.received)}</SensitiveAmount>} />
          <Stat label="Presentes" icon={Gift} tone="text-violet"
            value={<SensitiveAmount>{brl(p.gifts)}</SensitiveAmount>} />
          <Stat label={loan < 0 ? 'Empréstimo: você deve' : 'Empréstimo: te deve'}
            icon={HandCoins} tone={Math.abs(loan) > 0.005 ? 'text-amber' : 'text-muted'}
            value={<SensitiveAmount>{brl(Math.abs(loan))}</SensitiveAmount>} />
        </div>
        {(p.loan_count > 0 || open > 0) && (
          <p className="-mt-2 px-5 pb-4 text-[12px] text-faint">
            {p.loan_count > 0 && `Saldo dos ${p.loan_count} lançamento(s) em categoria de
              empréstimo (saída = emprestou, entrada = devolveu ou pegou). `}
            {open > 0 && <>Pendências em "Com quem": <SensitiveAmount>{brl(open)}
            </SensitiveAmount>.</>}
          </p>
        )}
      </Card>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card>
          <CardHead title="Por categoria" sub="Saídas para esta pessoa" />
          <div className="px-5 pb-5"><HBars items={cats} byCat /></div>
        </Card>
        <Card>
          <CardHead title="Por mês" sub="Saídas nos últimos 12 meses com lançamento" />
          <div className="px-2 pb-4 sm:px-4"><TrendBars data={months} color="#b08cff" />
          </div>
        </Card>
      </div>

      {p.open_items.length > 0 && (
        <Card>
          <CardHead title="Em aberto"
            sub={`A receber ${brl(p.receivable)} · a pagar ${brl(p.payable)} (Com quem)`} />
          <ul className="divide-y divide-border border-t border-border text-[13px]">
            {p.open_items.map((it) => (
              <li key={`${it.id}:${it.part ?? ''}`}
                className="flex items-center justify-between gap-3 px-5 py-2.5">
                <span className="min-w-0 truncate"><span className="text-faint">
                  {fullDate(it.date)}</span> {it.description}</span>
                <SensitiveAmount className="tnum shrink-0 font-semibold text-amber">
                  {brl(it.open)}</SensitiveAmount>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card className="overflow-hidden">
        <CardHead title={`Lançamentos (${p.transactions.length})`} />
        <ul className="divide-y divide-border border-t border-border text-[13px]">
          {p.transactions.slice(0, 200).map((t) => (
            <li key={`${t.id}:${t.part ?? ''}`}
              className="flex items-center justify-between gap-3 px-5 py-2.5">
              <div className="min-w-0">
                <p className="truncate font-medium">{t.description}</p>
                <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[12px]
                  text-faint">
                  {fullDate(t.date)}
                  <span>{t.category || 'Sem categoria'}
                    {t.subcategory ? ` / ${t.subcategory}` : ''}</span>
                  {t.part != null && <Badge tone="violet">parte</Badge>}
                </p>
              </div>
              <SensitiveAmount className={`tnum shrink-0 font-semibold ${t.amount < 0
                ? 'text-red' : 'text-green'}`}>{signedBrl(t.amount)}</SensitiveAmount>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  )
}

export function Pessoas({ dash, goTxns }) {
  const people = dash.people || []
  const summary = dash.people_summary || {}
  const [selected, setSelected] = useState(null)
  const current = selected && summary[selected] ? selected : people[0]

  if (!people.length) {
    return (
      <Card className="px-6 py-12 text-center text-[13px] text-muted">
        <p className="text-[15px] font-semibold text-text">Ninguém marcado ainda</p>
        <p className="mx-auto mt-2 max-w-md">
          Na edição de um lançamento, preencha <b className="text-text">Para quem</b>{' '}
          (presente, ajuda, serviço pago para outra pessoa). Pelo Claude:{' '}
          <code className="rounded bg-white/10 px-1.5">"person": "Nome"</code> no
          {' '}<code className="rounded bg-white/10 px-1.5">.decisions.json</code>.</p>
      </Card>
    )
  }
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,280px)_minmax(0,1fr)]">
      <div className="min-w-0">
        <PersonList people={people} summary={summary} selected={current}
          onSelect={setSelected} />
      </div>
      {current && <PersonDetail p={summary[current]} goTxns={goTxns} />}
    </div>
  )
}
