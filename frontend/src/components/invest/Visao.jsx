import { TrendingUp, Wallet } from 'lucide-react'

import { brl } from '../../lib/format.js'
import { Card, CardHead } from '../ui/primitives.jsx'
import { SensitiveAmount } from '../ui/SensitiveValue.jsx'
import { DriftBar, DriftChip, Money, pct, Problems, Profit } from './shared.jsx'

function Tile({ label, children, sub }) {
  return (
    <Card className="px-5 py-4">
      <p className="text-[12px] font-semibold uppercase tracking-wider text-muted">
        {label}</p>
      <div className="mt-1.5 text-[22px] font-bold tracking-tight">{children}</div>
      {sub && <p className="mt-1 text-[12px] text-faint">{sub}</p>}
    </Card>
  )
}

// Área simples do patrimônio: o histórico vem dos snapshots diários, então o gráfico
// começa no dia em que o app entrou e cresce a partir dali.
function History({ points }) {
  if (points.length < 2) {
    return (
      <p className="px-5 pb-5 text-[13px] text-faint">
        O histórico começa a ser gravado a cada atualização. Volte amanhã para ver a
        primeira linha.
      </p>
    )
  }
  const width = 640
  const height = 150
  const values = points.flatMap((p) => [p.value, p.cost])
  const min = Math.min(...values) * 0.98
  const max = Math.max(...values) * 1.02
  const x = (index) => (index / (points.length - 1)) * width
  const y = (value) => height - ((value - min) / (max - min || 1)) * height
  const line = (key) => points.map((p, i) =>
    `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p[key]).toFixed(1)}`).join(' ')
  return (
    <div className="px-5 pb-5">
      <svg viewBox={`0 0 ${width} ${height}`} className="h-[150px] w-full"
        preserveAspectRatio="none" role="img"
        aria-label="Evolução do patrimônio e do valor investido">
        <path d={`${line('value')} L${width},${height} L0,${height} Z`}
          fill="var(--color-brand)" opacity="0.12" />
        <path d={line('cost')} fill="none" stroke="var(--color-faint)"
          strokeWidth="1.5" strokeDasharray="4 4" />
        <path d={line('value')} fill="none" stroke="var(--color-brand)"
          strokeWidth="2" />
      </svg>
      <div className="mt-2 flex justify-between text-[11px] text-faint">
        <span>{points[0].date.slice(5)}</span>
        <span className="tnum">
          <span className="text-brand-soft">patrimônio</span> ·{' '}
          <span>investido</span>
        </span>
        <span>{points[points.length - 1].date.slice(5)}</span>
      </div>
    </div>
  )
}

export function Visao({ data, goTab }) {
  const { totals, allocation, plan, history, problems } = data
  const reserves = totals.value - totals.eligible_value
  const counted = allocation.filter((item) => item.in_totals)

  return (
    <div className="flex flex-col gap-4">
      <Problems items={problems} />

      <div className="grid gap-4 sm:grid-cols-3">
        <Tile label="Patrimônio"
          sub={reserves > 0.01
            ? `${brl(totals.eligible_value)} na estratégia · ${brl(reserves)} fora`
            : 'tudo dentro da estratégia'}>
          <Money value={totals.value} />
        </Tile>
        <Tile label="Rentabilidade"
          sub={`custo ${brl(totals.cost)}`}>
          <Profit value={totals.profit} pctValue={totals.profit_pct} />
        </Tile>
        <Tile label="Proventos e vendas"
          sub={totals.realized ? `inclui ${brl(totals.realized)} realizados` : 'recebido até aqui'}>
          <Money value={totals.income + totals.realized} />
        </Tile>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <Card>
          <CardHead title="Evolução do patrimônio"
            sub="linha cheia: valor de mercado; tracejada: quanto foi investido" />
          <History points={history || []} />
        </Card>

        <Card>
          <CardHead title="Próximo aporte"
            sub={`plano de ${brl(plan.contribution)}`}
            right={<TrendingUp className="size-4 text-brand" />} />
          <div className="flex flex-col gap-2 px-5 pb-4">
            {plan.orders.length === 0 && (
              <p className="text-[13px] text-faint">
                Defina o aporte mensal para ver a sugestão.</p>
            )}
            {plan.orders.slice(0, 5).map((order) => (
              <div key={order.ticker}
                className="flex items-center justify-between gap-3 rounded-xl
                  bg-surface2/50 px-3 py-2">
                <div>
                  <p className="text-[13px] font-semibold">{order.ticker}</p>
                  {order.quantity > 0 && (
                    <p className="tnum text-[11px] text-faint">
                      {order.quantity.toLocaleString('pt-BR')} ×{' '}
                      {brl(order.price)}</p>
                  )}
                </div>
                <span className="tnum text-[13px]">
                  <SensitiveAmount>{brl(order.amount)}</SensitiveAmount></span>
              </div>
            ))}
            {plan.leftover > 0.01 && (
              <p className="text-[12px] text-faint">
                Sobra {brl(plan.leftover)}: não cabe num lote inteiro.</p>
            )}
            <button onClick={() => goTab('aporte')}
              className="mt-1 self-start text-[13px] font-semibold text-brand
                hover:underline">
              Simular no Aporte →
            </button>
          </div>
        </Card>
      </div>

      <Card>
        <CardHead title="Alocação" sub="barra cheia: onde está; barra clara: alvo"
          right={<Wallet className="size-4 text-muted" />} />
        <div className="flex flex-col gap-3 px-5 pb-5">
          {counted.map((item) => (
            <div key={item.node} className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1
              sm:grid-cols-[160px_1fr_auto_auto] sm:items-center">
              <span className="text-[13px] font-semibold">{item.name}</span>
              <div className="order-3 col-span-2 sm:order-none sm:col-span-1">
                <DriftBar real={item.real_pct} target={item.target_pct} />
              </div>
              <span className="tnum text-right text-[12px] text-muted">
                {pct(item.real_pct)} / {pct(item.target_pct)}</span>
              <DriftChip drift={item.drift} />
            </div>
          ))}
          {allocation.filter((item) => !item.in_totals && item.value > 0).map((item) => (
            <div key={item.node} className="flex items-center justify-between
              border-t border-border/60 pt-3 text-[13px]">
              <span className="text-muted">{item.name}
                <span className="ml-2 text-[11px] text-faint">fora dos alvos</span></span>
              <Money value={item.value} className="tnum" />
            </div>
          ))}
        </div>
      </Card>
    </div>
  )
}
