import { useState } from 'react'
import { ChevronDown, CreditCard, Landmark, ReceiptText, TriangleAlert } from 'lucide-react'
import { brl, fullDate, monthLabel, monthShortY } from '../lib/format.js'
import { Badge, Card, CardHead } from './ui/primitives.jsx'
import { SensitiveAmount } from './ui/SensitiveValue.jsx'
import { TrendBars } from './charts.jsx'

// Parcelas vêm prontas do relatório (finance/installments.py): agrupar por compra
// depende do histórico inteiro, então esta tela não segue o seletor Mês/Ano.

const KIND = {
  compra: { label: 'Compra parcelada', icon: CreditCard },
  fatura: { label: 'Parcelamento de fatura', icon: ReceiptText },
  emprestimo: { label: 'Empréstimo', icon: Landmark },
}

function Stat({ label, value, sub, tone = 'text-strong' }) {
  return (
    <Card className="min-w-0 px-4 py-3.5 sm:px-5 sm:py-4">
      <p className="text-[12px] font-medium uppercase tracking-wider text-faint">{label}</p>
      <p className={`mt-1 truncate text-[20px] font-bold tnum sm:text-[22px] ${tone}`}>
        {value}</p>
      {sub && <p className="mt-0.5 truncate text-[12px] text-muted">{sub}</p>}
    </Card>
  )
}

function Progress({ paid, total }) {
  const pct = total ? Math.min(100, (paid / total) * 100) : 0
  return (
    <div className="flex items-center gap-3">
      <div className="h-2 min-w-16 flex-1 overflow-hidden rounded-full bg-surface2"
        role="progressbar" aria-valuenow={paid} aria-valuemin={0} aria-valuemax={total}
        aria-label={`${paid} de ${total} parcelas`}>
        <div className="h-full rounded-full bg-brand" style={{ width: `${pct}%` }} />
      </div>
      <span className="tnum shrink-0 text-[12px] font-semibold text-muted">
        {paid}/{total}</span>
    </div>
  )
}

function Lines({ rows }) {
  return (
    <ul className="mt-3 divide-y divide-border/60 rounded-xl border border-border/70
      bg-bg/40 text-[12.5px]">
      {rows.map((t) => (
        <li key={t.id} className="flex items-center justify-between gap-3 px-3 py-1.5">
          <span className="min-w-0 truncate text-muted">{fullDate(t.date)}
            {t.installment && <span className="ml-2 text-faint">{t.installment}</span>}
            {t.description && <span className="ml-2 text-faint">{t.description}</span>}
          </span>
          <SensitiveAmount className={`tnum shrink-0 ${t.amount < 0
            ? 'text-red' : 'text-green'}`}>{brl(t.amount)}</SensitiveAmount>
        </li>
      ))}
    </ul>
  )
}

function PlanRow({ plan }) {
  const [open, setOpen] = useState(false)
  const Icon = KIND[plan.kind]?.icon || CreditCard
  const loan = plan.kind === 'emprestimo'
  return (
    <div className="px-4 py-3.5 sm:px-5">
      <button onClick={() => setOpen((o) => !o)} aria-expanded={open}
        title={KIND[plan.kind]?.label}
        className="flex w-full items-start gap-3 text-left">
        <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg
          bg-surface2 text-muted"><Icon className="size-4" /></span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="min-w-0 truncate text-[14px] font-semibold">
              {plan.description}</span>
            {plan.overdue_installments > 0 && (
              <Badge tone="amber">{plan.overdue_installments} não veio no extrato</Badge>)}
            {plan.status === 'stale' && <Badge tone="amber">sem parcela recente</Badge>}
            {plan.status === 'duplicate' && <Badge tone="amber">possível duplicata</Badge>}
          </div>
          <p className="mt-0.5 truncate text-[12px] text-faint">
            {plan.account_name}
            {plan.category && ` · ${plan.category}${plan.subcategory
              ? ` / ${plan.subcategory}` : ''}`}
            {loan && plan.categories?.length > 1 && ` · ${plan.categories.join(', ')}`}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <p className="tnum text-[14px] font-semibold">
            <SensitiveAmount>{brl(plan.parcel_amount)}</SensitiveAmount>
            <span className="text-[11px] font-normal text-faint">/mês</span></p>
          {!loan && plan.status === 'active' && (
            <p className="text-[11.5px] text-muted">falta{' '}
              <SensitiveAmount className="tnum font-semibold text-text">
                {brl(plan.remaining_amount)}</SensitiveAmount></p>)}
          {loan && <p className="text-[11.5px] text-muted">{plan.payments} pagas</p>}
        </div>
        <ChevronDown className={`mt-1 size-4 shrink-0 text-faint transition ${
          open ? 'rotate-180' : ''}`} />
      </button>
      {!loan && (
        <div className="mt-2.5 pl-11">
          <Progress paid={plan.paid_installments} total={plan.total_installments} />
          <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-0.5 text-[12px] text-muted">
            {plan.status === 'active' && (
              <span>{plan.remaining_installments} restante
                {plan.remaining_installments === 1 ? '' : 's'}</span>)}
            <span>termina em <b className="font-semibold text-text">
              {monthLabel(plan.end_month)}</b></span>
            <span>total <SensitiveAmount className="tnum">{brl(plan.total_amount)}
            </SensitiveAmount></span>
            {plan.interest != null && (
              <span>juros <SensitiveAmount className="tnum font-semibold text-red">
                {brl(plan.interest)}</SensitiveAmount> sobre{' '}
                <SensitiveAmount className="tnum">{brl(plan.principal)}</SensitiveAmount>
              </span>)}
          </div>
        </div>
      )}
      {loan && (
        <p className="mt-2 pl-11 text-[12px] text-muted">
          Sem número de parcelas no extrato · pago{' '}
          <SensitiveAmount className="tnum font-semibold text-text">
            {brl(plan.paid_amount)}</SensitiveAmount> de {fullDate(plan.first_date)} a{' '}
          {fullDate(plan.last_date)}</p>
      )}
      {open && (
        <div className="pl-11">
          <Lines rows={[...plan.transactions, ...(plan.related || [])]
            .sort((a, b) => a.date.localeCompare(b.date))} />
        </div>
      )}
    </div>
  )
}

function Section({ title, sub, plans, empty }) {
  if (!plans.length && !empty) return null
  return (
    <Card className="overflow-hidden">
      <CardHead title={`${title} (${plans.length})`} sub={sub} />
      {plans.length === 0
        ? <p className="px-5 pb-6 text-[13px] text-faint">{empty}</p>
        : <div className="divide-y divide-border border-t border-border">
          {plans.map((p) => <PlanRow key={p.id} plan={p} />)}</div>}
    </Card>
  )
}

export function Parcelamentos({ data }) {
  const [showDone, setShowDone] = useState(false)
  if (!data) {
    return (
      <Card className="px-6 py-12 text-center text-[13px] text-muted">
        Rode <code className="rounded bg-white/10 px-1.5">uv run python -m finance.report</code>{' '}
        para gerar as parcelas.
      </Card>
    )
  }
  const { plans = [], loans = [], schedule = [], totals = {} } = data
  const active = plans.filter((p) => p.status === 'active')
  const compras = active.filter((p) => p.kind === 'compra')
  const faturas = plans.filter((p) => p.kind === 'fatura' && p.status !== 'completed')
  const check = plans.filter((p) => p.status === 'stale' || p.status === 'duplicate')
  const done = plans.filter((p) => p.status === 'completed')
  const allFaturas = plans.filter((p) => p.kind === 'fatura')
  const bars = schedule.map((r) => ({ lbl: monthShortY(r.month), value: r.total }))

  return (
    <div className="flex flex-col gap-4">
      <p className="text-[12.5px] text-faint">
        Todo o histórico, não depende do mês selecionado. Compras agrupadas pelo campo
        "n/N" da Pluggy (identificação estimada).</p>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Falta pagar" value={<SensitiveAmount>{brl(totals.remaining_amount)}
        </SensitiveAmount>} sub={`${totals.active_plans || 0} parcelamento(s) ativo(s)`} />
        <Stat label="Próxima fatura" value={<SensitiveAmount>
          {brl(schedule[0]?.total)}</SensitiveAmount>}
          sub={schedule[0] ? monthLabel(schedule[0].month) : '—'} />
        <Stat label="Última parcela" value={totals.end_month
          ? monthShortY(totals.end_month) : '—'} sub="quando tudo termina" />
        <Stat label="Juros de fatura" tone="text-red"
          value={<SensitiveAmount>{brl(totals.fatura_interest)}</SensitiveAmount>}
          sub={`${allFaturas.length} parcelamento(s) de fatura`} />
      </div>

      <Card>
        <CardHead title="Comprometido por mês"
          sub="Parcelas que ainda vão cair nas próximas 12 faturas" />
        <div className="px-2 pb-4 sm:px-4">
          <TrendBars data={bars} color="#5b9dff" />
        </div>
        {(totals.overdue_amount > 0 || totals.loans_monthly > 0) && (
          <div className="flex flex-col gap-1 border-t border-border px-5 py-3 text-[12.5px]
            text-muted">
            {totals.overdue_amount > 0 && (
              <p className="flex items-start gap-2"><TriangleAlert className="mt-0.5 size-3.5
                shrink-0 text-amber" /> <span><SensitiveAmount className="tnum font-semibold
                text-text">{brl(totals.overdue_amount)}</SensitiveAmount> em parcelas que já
                deviam estar numa fatura do Ledger e ainda não vieram (fora do gráfico).
              </span></p>)}
            {totals.loans_monthly > 0 && (
              <p>+ <SensitiveAmount className="tnum font-semibold text-text">
                {brl(totals.loans_monthly)}</SensitiveAmount>/mês de empréstimo sem prazo
                conhecido (fora do gráfico).</p>)}
          </div>
        )}
      </Card>

      <Section title="Compras parceladas" sub="Ordenadas pelo fim" plans={compras}
        empty="Nenhuma compra parcelada em aberto." />
      <Section title="Parcelamento de fatura"
        sub="Ficam em Transferências/Pagamento de cartão; aqui com o juro" plans={faturas} />
      <Section title="Empréstimos" sub="Pagamentos recorrentes sem n/N no extrato"
        plans={loans} />
      <Section title="Para conferir"
        sub="Parcelas que pararam de vir ou 1/N repetido no mesmo dia; fora das contas"
        plans={check} />

      {done.length > 0 && (
        <div>
          <button onClick={() => setShowDone((s) => !s)}
            className="flex items-center gap-2 text-[13px] font-semibold text-muted
              hover:text-text">
            <ChevronDown className={`size-4 transition ${showDone ? 'rotate-180' : ''}`} />
            Finalizados ({done.length})
          </button>
          {showDone && <div className="mt-3"><Section title="Finalizados" plans={done} />
          </div>}
        </div>
      )}
    </div>
  )
}
