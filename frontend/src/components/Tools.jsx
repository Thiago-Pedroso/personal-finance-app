import { useMemo, useState } from 'react'
import { Card, CardHead } from './ui/primitives.jsx'
import { Slider } from './ui/Slider.jsx'
import { inputCls } from './ui/MultiSelect.jsx'
import { WealthChart, Sparkline } from './charts.jsx'
import { catMeta } from '../lib/categories.jsx'
import { deriveToolsInputs } from '../lib/toolsInputs.js'
import {
  projectWealth, RATE_PRESETS, DEFAULT_INFLATION,
  auditRecurring, emergencyReserve, savingsRateSeries,
} from '../lib/finance.js'
import { brl, brl0, fmtPct } from '../lib/format.js'
import {
  ShieldCheck, PiggyBank, Sparkles,
  TrendingUp, TrendingDown, Repeat,
} from 'lucide-react'

// input de moeda enxuto (R$ à esquerda, número à direita)
function MoneyInput({ value, onChange, className = '' }) {
  return (
    <div className="relative">
      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2
        text-[12px] text-faint">R$</span>
      <input type="number" value={value}
        onChange={(e) => onChange(e.target.value === '' ? 0 : +e.target.value)}
        className={inputCls(`w-full pl-8 tnum ${className}`)} />
    </div>
  )
}

function Field({ label, hint, children }) {
  return (
    <label className="block">
      <div className="flex items-baseline justify-between">
        <span className="text-[12px] font-medium text-muted">{label}</span>
        {hint && <span className="text-[11px] text-faint">{hint}</span>}
      </div>
      <div className="mt-1.5">{children}</div>
    </label>
  )
}

function Metric({ label, value, tone = 'text-text', sub }) {
  return (
    <div>
      <div className="text-[11px] font-semibold uppercase tracking-wider text-muted">
        {label}</div>
      <div className={`mt-0.5 text-[15px] font-bold tnum ${tone}`}>{value}</div>
      {sub && <div className="text-[11px] text-faint">{sub}</div>}
    </div>
  )
}

function Projetor({ inp }) {
  const thisYear = new Date().getFullYear()
  const [initial, setInitial] = useState(inp.patrimonio || 0)
  const [monthly, setMonthly] = useState(inp.aporteSugerido || 500)
  const [rateKey, setRateKey] = useState('cdi')
  const [customRate, setCustomRate] = useState(10)
  const [years, setYears] = useState(15)
  const [stepUp, setStepUp] = useState(false)

  const annualRate = rateKey === 'custom'
    ? customRate : RATE_PRESETS.find((r) => r.key === rateKey)?.rate ?? 10

  const r = useMemo(() => projectWealth({
    initial, monthly, annualRate, years, stepUpPct: stepUp ? 5 : 0,
    inflationPct: DEFAULT_INFLATION,
  }), [initial, monthly, annualRate, years, stepUp])

  const cross = r.crossoverMonth
    ? `Juros passam o aporte no ano ${Math.ceil(r.crossoverMonth / 12)}`
    : 'Juros não superam o aporte nesse prazo'

  return (
    <Card className="overflow-hidden">
      <CardHead title="Projetor de Patrimônio"
        sub="seus números reais, editáveis — o resultado recalcula na hora" />
      <div className="grid gap-6 px-5 pb-6 lg:grid-cols-[minmax(0,340px)_1fr]">
        {/* entradas */}
        <div className="flex flex-col gap-4">
          <Field label="Aporte inicial" hint="saldo das metas (Reserva)">
            <MoneyInput value={initial} onChange={setInitial} />
          </Field>
          <Field label="Aporte mensal"
            hint={`sua sobra média: ${brl(inp.sobraMedia)}`}>
            <MoneyInput value={monthly} onChange={setMonthly} />
            <Slider className="mt-2.5" value={Math.min(monthly, 10000)}
              min={0} max={10000} step={50} onChange={setMonthly} />
          </Field>
          <Field label="Rentabilidade (a.a.)">
            <div className="flex flex-wrap gap-1 rounded-xl border border-border
              bg-surface2/70 p-1">
              {[...RATE_PRESETS, { key: 'custom', label: 'Custom' }].map((p) => (
                <button key={p.key} onClick={() => setRateKey(p.key)}
                  className={`flex-1 rounded-lg px-2 py-1.5 text-[12px] font-semibold
                    transition ${rateKey === p.key
                      ? 'bg-brand text-white shadow-[0_1px_6px_#5b9dff55]'
                      : 'text-muted hover:text-text'}`}>
                  {p.label}{p.rate ? ` ${p.rate}%` : ''}
                </button>
              ))}
            </div>
            {rateKey === 'custom' && (
              <div className="mt-2 flex items-center gap-2">
                <input type="number" value={customRate}
                  onChange={(e) => setCustomRate(+e.target.value || 0)}
                  className={inputCls('w-24 tnum')} step="0.5" />
                <span className="text-[12px] text-faint">% ao ano</span>
              </div>
            )}
          </Field>
          <Field label="Prazo" hint={`${years} anos · até ${thisYear + years}`}>
            <Slider value={years} min={1} max={40} step={1} onChange={setYears} />
          </Field>
          <label className="flex cursor-pointer items-center gap-2 text-[12.5px]
            text-muted">
            <input type="checkbox" checked={stepUp}
              onChange={(e) => setStepUp(e.target.checked)} className="accent-brand" />
            Aumentar o aporte 5% a cada ano
          </label>
        </div>

        {/* resultado */}
        <div className="flex flex-col gap-4 rounded-2xl border border-border
          bg-surface2/30 p-5">
          <div>
            <div className="text-[12px] font-semibold uppercase tracking-wider
              text-muted">Patrimônio em {thisYear + years}</div>
            <div className="mt-1 text-[34px] font-bold tnum text-brand">
              {brl(r.finalBalance)}</div>
          </div>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Metric label="Aportado" value={brl0(r.contributed)} />
            <Metric label="Juros" value={brl0(r.interest)} tone="text-green" />
            <Metric label="Rende no fim" value={`${brl0(r.interestPerMonth)}/mês`}
              tone="text-green" sub="sem trabalhar" />
            <Metric label="Valor de hoje" value={brl0(r.realValue)}
              sub={`descontando ${DEFAULT_INFLATION}% IPCA`} />
          </div>
          <div className="rounded-lg border border-brand/25 bg-brand/[0.06] px-3
            py-2 text-[12.5px] text-brand">{cross}</div>
          <WealthChart series={r.series} />
        </div>
      </div>
    </Card>
  )
}

const RES_STATUS = {
  ok: ['text-green', '#41cf8f'], quase: ['text-amber', '#f2954e'],
  baixo: ['text-red', '#f56a60'],
}

function ReservaCard({ inp }) {
  const [saldo, setSaldo] = useState(inp.patrimonio || 0)
  const [gasto, setGasto] = useState(Math.round(inp.gastosEssenciais) || 0)
  const [target, setTarget] = useState(6)
  const r = useMemo(() => emergencyReserve({
    gastosMedios: gasto, saldo, targetMonths: target,
  }), [gasto, saldo, target])
  const [tone, bar] = RES_STATUS[r.status]

  return (
    <Card className="flex flex-col p-5">
      <div className="flex items-center gap-2">
        <span className="grid size-8 place-items-center rounded-xl bg-surface2
          text-muted"><ShieldCheck className="size-4" /></span>
        <h3 className="text-[14px] font-semibold">Reserva de emergência</h3>
      </div>
      <div className="mt-3 flex items-baseline gap-2">
        <span className={`text-[30px] font-bold tnum ${tone}`}>
          {r.months.toFixed(1)}</span>
        <span className="text-[13px] text-muted">meses de colchão</span>
      </div>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/[0.06]">
        <div className="h-full rounded-full transition-[width] duration-500"
          style={{ width: `${r.pct}%`, background: bar }} />
      </div>
      <div className="mt-1.5 flex justify-between text-[11.5px] text-faint">
        <span>meta {target} meses</span>
        <span>{r.missing > 0 ? `faltam ${brl0(r.missing)}` : 'meta batida ✓'}</span>
      </div>
      <div className="mt-4 flex flex-col gap-2 border-t border-border pt-3">
        <label className="flex items-center justify-between gap-2 text-[12px]
          text-muted">Tenho hoje
          <input type="number" value={saldo}
            onChange={(e) => setSaldo(e.target.value === '' ? 0 : +e.target.value)}
            className={inputCls('w-32 py-1 tnum')} />
        </label>
        <label className="flex items-center justify-between gap-2 text-[12px]
          text-muted">Gasto essencial/mês
          <input type="number" value={gasto}
            onChange={(e) => setGasto(e.target.value === '' ? 0 : +e.target.value)}
            className={inputCls('w-32 py-1 tnum')} />
        </label>
        <div className="flex items-center gap-1 rounded-lg border border-border
          bg-surface2/70 p-1 text-[12px]">
          {[3, 6, 12].map((n) => (
            <button key={n} onClick={() => setTarget(n)}
              className={`flex-1 rounded-md py-1 font-semibold transition ${
                target === n ? 'bg-brand text-white' : 'text-muted hover:text-text'}`}>
              {n} meses</button>
          ))}
        </div>
        <p className="text-[11px] text-faint">
          pré-preenchido com seus essenciais (Moradia, Alimentação, Saúde,
          Transporte, Serviços): {brl(inp.gastosEssenciais)}/mês — ajuste se quiser</p>
      </div>
    </Card>
  )
}

function SavingsRateCard({ months }) {
  const s = useMemo(() => savingsRateSeries(months), [months])
  const up = s.trend >= 0
  // só meses com renda relevante, com clamp pra um mês atípico não achatar a curva
  const spark = s.rows.filter((r) => r.rate != null)
    .map((r) => Math.max(-100, Math.min(100, r.rate)))
  return (
    <Card className="flex flex-col p-5">
      <div className="flex items-center gap-2">
        <span className="grid size-8 place-items-center rounded-xl bg-surface2
          text-muted"><PiggyBank className="size-4" /></span>
        <h3 className="text-[14px] font-semibold">Taxa de poupança</h3>
      </div>
      <div className="mt-3 flex items-end justify-between">
        <div className="flex items-baseline gap-2">
          <span className={`text-[30px] font-bold tnum ${
            s.avg >= 0 ? 'text-green' : 'text-red'}`}>{s.avg.toFixed(0)}%</span>
          <span className="text-[13px] text-muted">da renda, em média</span>
        </div>
        <Sparkline data={spark} color={s.avg >= 0 ? '#41cf8f' : '#f56a60'}
          width={90} height={30} />
      </div>
      <div className="mt-3 flex items-center gap-4 border-t border-border pt-3
        text-[12.5px]">
        <span className="text-muted">último mês{' '}
          <b className="tnum text-text">{s.current.toFixed(0)}%</b></span>
        <span className={`flex items-center gap-1 ${up ? 'text-green' : 'text-red'}`}>
          {up ? <TrendingUp className="size-3.5" /> : <TrendingDown className="size-3.5" />}
          {fmtPct(s.trend)} de tendência</span>
      </div>
      <p className="mt-2 text-[11px] text-faint">
        quanto da sua renda sobra por mês (12 meses)</p>
    </Card>
  )
}

function AuditorCard({ recurring }) {
  const a = useMemo(() => auditRecurring(recurring), [recurring])
  const max = a.items[0]?.yearly || 1
  return (
    <Card>
      <CardHead title="Auditor de recorrentes"
        sub="assinaturas e contas regulares detectadas — anualizadas pela cadência" />
      <div className="grid gap-5 px-5 pb-5 lg:grid-cols-[minmax(0,240px)_1fr]">
        <div className="rounded-2xl border border-border bg-surface2/30 p-4">
          <div className="text-[11px] font-semibold uppercase tracking-wider
            text-muted">Gasto recorrente</div>
          <div className="mt-1 text-[30px] font-bold tnum text-red">
            {brl0(a.totalYearly)}</div>
          <div className="text-[12px] text-faint">por ano · {brl(a.totalMonthly)}/mês</div>
          <div className="mt-3 border-t border-border pt-3 text-[12px] text-muted">
            {a.items.length} cobranças recorrentes. Revise o que não usa mais —
            cortar as maiores é onde está o dinheiro.
          </div>
        </div>
        <div className="flex flex-col gap-2.5">
          {a.items.length === 0 && (
            <p className="py-8 text-center text-[13px] text-faint">
              Nenhuma recorrência detectada ainda.</p>
          )}
          {a.items.map((it) => {
            const M = catMeta(it.category)
            return (
              <div key={it.label + it.amount} className="group">
                <div className="mb-1 flex items-center justify-between gap-2
                  text-[13px]">
                  <span className="flex min-w-0 items-center gap-1.5">
                    <M.Icon className="size-3.5 shrink-0"
                      style={{ color: M.color }} />
                    <span className="truncate">{it.label}</span>
                    <span className="flex shrink-0 items-center gap-1 text-[11px]
                      text-faint"><Repeat className="size-3" />{it.cadence}</span>
                  </span>
                  <span className="tnum shrink-0 text-muted">
                    {brl0(it.yearly)}<span className="text-faint">/ano</span></span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
                  <div className="h-full rounded-full"
                    style={{ width: `${Math.max(3, (it.yearly / max) * 100)}%`,
                      background: M.color }} />
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </Card>
  )
}

export function Tools({ dash }) {
  const inp = useMemo(() => deriveToolsInputs(dash), [dash])

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h2 className="flex items-center gap-2 text-[17px] font-bold">
          <Sparkles className="size-4 text-brand" /> Ferramentas
        </h2>
        <p className="mt-0.5 text-[12.5px] text-faint">
          Simuladores com os seus números reais — média de{' '}
          {inp.window} meses. Ajuste e veja na hora.
        </p>
      </div>

      <Projetor inp={inp} />

      <div className="grid gap-4 lg:grid-cols-2">
        <ReservaCard inp={inp} />
        <SavingsRateCard months={dash?.months || []} />
      </div>

      <AuditorCard recurring={dash?.recurring || []} />
    </div>
  )
}
