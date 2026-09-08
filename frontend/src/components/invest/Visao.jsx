import { useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts'

import { brl } from '../../lib/format.js'
import { buildInvestmentComposition } from '../../lib/investComposition.js'
import { Button, Card } from '../ui/primitives.jsx'
import { SensitiveAmount } from '../ui/SensitiveValue.jsx'
import { DriftBar, DriftChip, InvestmentCardHeader, InvestmentPageHeader,
  Money, pct, Problems, Profit } from './shared.jsx'

const COMPOSITION_COLORS = [
  '#5b9dff', '#68d9a2', '#f3b477', '#b08cff', '#55c2d9', '#f07f86',
  '#d7c46c', '#7c9cff',
]

function compositionColor(slice) {
  if (slice.color) return slice.color
  const hash = [...slice.node].reduce(
    (total, character) => total + character.charCodeAt(0), 0)
  return COMPOSITION_COLORS[hash % COMPOSITION_COLORS.length]
}

function Wealth({ money }) {
  const lines = [
    ['Investido', money.invested, 'na estratégia'],
    ['Reservado', money.reserved, 'guardado com destino'],
    ['A aportar', money.to_invest, 'saiu da conta, ainda não virou posição'],
    ['Livre', money.free, 'sem compromisso'],
  ].filter(([, value]) => Math.abs(value) > 0.005)
  return (
    <Card className="p-5 sm:p-6">
      <p className="text-[15px] font-bold text-secondary">Patrimônio total</p>
      <p className="tnum mt-2 text-[30px] font-bold tracking-[-0.03em] text-strong
        sm:text-[34px]"><Money value={money.total} /></p>
      <div className="mt-6 grid gap-4 border-t border-border/70 pt-5 sm:grid-cols-2">
        {lines.map(([label, value, hint]) => (
          <div key={label} title={hint}>
            <p className="text-[13px] text-subtle">{label}</p>
            <p className="tnum mt-1 text-[17px] font-semibold text-strong">
              <Money value={value} /></p>
          </div>
        ))}
      </div>
    </Card>
  )
}

function Tile({ label, children, sub }) {
  return (
    <Card className="flex min-h-[150px] flex-col justify-center px-5 py-5 sm:px-6">
      <p className="text-[15px] font-bold text-secondary">
        {label}</p>
      <div className="mt-2 text-[27px] font-bold tracking-[-0.025em] text-strong">
        {children}</div>
      {sub && <p className="mt-2 text-[14px] text-subtle">{sub}</p>}
    </Card>
  )
}

function History({ points }) {
  if (points.length < 2) {
    return (
      <div className="grid min-h-[220px] place-items-center px-6 pb-6 text-center">
        <p className="max-w-md text-[14px] leading-6 text-subtle">
          O histórico começa na primeira atualização da carteira. Uma nova posição
          será adicionada a cada dia.</p>
      </div>
    )
  }
  const width = 640
  const height = 220
  const values = points.flatMap((p) => [p.value, p.cost])
  const min = Math.min(...values) * 0.98
  const max = Math.max(...values) * 1.02
  const x = (index) => (index / (points.length - 1)) * width
  const y = (value) => height - ((value - min) / (max - min || 1)) * height
  const line = (key) => points.map((p, i) =>
    `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p[key]).toFixed(1)}`).join(' ')
  return (
    <div className="px-5 pb-5 sm:px-6 sm:pb-6">
      <svg viewBox={`0 0 ${width} ${height}`} className="h-[220px] w-full"
        preserveAspectRatio="none" role="img"
        aria-label="Evolução do patrimônio e do valor investido">
        <path d={`${line('value')} L${width},${height} L0,${height} Z`}
          fill="var(--color-brand)" opacity="0.12" />
        <path d={line('cost')} fill="none" stroke="var(--color-faint)"
          strokeWidth="1.5" strokeDasharray="4 4" />
        <path d={line('value')} fill="none" stroke="var(--color-brand)"
          strokeWidth="2" />
      </svg>
      <div className="mt-3 flex justify-between text-[13px] text-subtle">
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

function PortfolioComposition({ allocation, policy }) {
  const [scope, setScope] = useState('strategy')
  const strategy = buildInvestmentComposition({ allocation, policy })
  const portfolio = buildInvestmentComposition({
    allocation, policy, scope: 'portfolio',
  })
  const composition = scope === 'portfolio' ? portfolio : strategy
  const hasOutsideInvestments = portfolio.slices.some((slice) => slice.outsideStrategy)

  return (
    <Card>
      <InvestmentCardHeader title="Composição dos investimentos"
        description="Veja as proporções da base de alocação ou inclua investimentos fora do rebalanceamento."
        right={hasOutsideInvestments ? (
          <div className="flex rounded-xl border border-border bg-surface2/70 p-1">
            {[
              ['strategy', 'Estratégia'],
              ['portfolio', 'Todos'],
            ].map(([key, label]) => (
              <button key={key} onClick={() => setScope(key)}
                aria-pressed={scope === key}
                className={`min-h-9 rounded-lg px-3 text-[13px] font-bold transition
                  ${scope === key
                    ? 'bg-brand text-white'
                    : 'text-secondary hover:text-strong'}`}>
                {label}
              </button>
            ))}
          </div>
        ) : null} />
      {composition.total > 0 ? (
        <div className="px-5 pb-6 sm:px-6">
          <div className="relative h-[250px] min-w-0" role="img"
            aria-label="Gráfico de composição dos investimentos">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={composition.slices} dataKey="value" nameKey="name"
                  innerRadius={72} outerRadius={104} paddingAngle={2}
                  stroke="var(--color-surface)" strokeWidth={3}>
                  {composition.slices.map((slice) => (
                    <Cell key={slice.node} fill={compositionColor(slice)} />
                  ))}
                </Pie>
                <Tooltip content={({ active, payload }) => active && payload?.length ? (
                  <div className="rounded-xl border border-border bg-surface2/95
                    px-3 py-2 text-[13px] shadow-xl">
                    <p className="font-bold text-strong">{payload[0].name}</p>
                    <p className="tnum mt-1 text-secondary">
                      <Money value={payload[0].value} /> ·{' '}
                      {pct(payload[0].payload.share)}</p>
                  </div>
                ) : null} />
              </PieChart>
            </ResponsiveContainer>
            <div className="pointer-events-none absolute inset-0 grid place-content-center
              text-center">
              <p className="text-[12px] font-semibold text-subtle">Total exibido</p>
              <p className="tnum mt-1 text-[18px] font-bold text-strong">
                <Money value={composition.total} /></p>
            </div>
          </div>
          <div className="grid gap-2">
            {composition.slices.map((slice) => (
              <div key={slice.node} className="flex items-center gap-3 rounded-xl
                px-3 py-2 hover:bg-surface2/45">
                <span className="size-3 shrink-0 rounded-[4px]"
                  style={{ background: compositionColor(slice) }} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[14px] font-semibold text-strong">
                    {slice.name}</p>
                  {slice.outsideStrategy && (
                    <p className="text-[12px] text-subtle">Fora do rebalanceamento</p>
                  )}
                </div>
                <div className="text-right">
                  <p className="tnum text-[15px] font-bold text-strong">
                    {pct(slice.share)}</p>
                  <p className="tnum mt-0.5 text-[13px] text-secondary">
                    <Money value={slice.value} /></p>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <p className="px-6 pb-8 pt-4 text-center text-[14px] text-subtle">
          Ainda não há investimentos para compor o gráfico.</p>
      )}
    </Card>
  )
}

export function Visao({ data, goTab, onRefresh, busy }) {
  const { totals, allocation, plan, history, problems } = data
  const money = data.wealth
    || { invested: totals.eligible_value, reserved: 0, to_invest: 0,
      free: totals.value - totals.eligible_value, total: totals.value }
  const reserves = totals.value - totals.eligible_value
  const counted = allocation.filter((item) => item.in_totals)
  const outsideStrategy = allocation.filter((item) => !item.in_totals && item.value > 0)

  return (
    <div className="flex flex-col gap-6">
      <InvestmentPageHeader eyebrow="Visão geral" title="Sua carteira em um só lugar"
        description="Acompanhe o patrimônio, o desempenho e a distância entre a alocação atual e a sua estratégia."
        right={(
          <Button variant="ghost" onClick={onRefresh} disabled={busy}
            className="min-h-10 text-[14px]">
            <RefreshCw className={`size-4 ${busy
              ? 'animate-[spin_.8s_linear_infinite]' : ''}`} />
            Atualizar carteira
          </Button>
        )} />

      <Problems items={problems} />

      <div className="grid gap-5 xl:grid-cols-[1.15fr_.85fr_.85fr]">
        <Wealth money={money} />
        <div className="grid gap-5">
          <Tile label="Rentabilidade" sub={`custo ${brl(totals.cost)}`}>
            <Profit value={totals.profit} pctValue={totals.profit_pct} />
          </Tile>
          <Tile label="Proventos e vendas"
            sub={totals.realized
              ? `inclui ${brl(totals.realized)} realizados` : 'recebido até aqui'}>
            <Money value={totals.income + totals.realized} />
          </Tile>
        </div>
        <Tile label="Na estratégia"
          sub={reserves > 0.01
            ? `${brl(reserves)} estão separados do rebalanceamento`
            : 'todo o patrimônio participa do rebalanceamento'}>
          <Money value={totals.eligible_value} />
        </Tile>
      </div>

      <div className="grid gap-5 lg:grid-cols-[1.45fr_1fr]">
        <Card>
          <InvestmentCardHeader title="Evolução do patrimônio"
            description="A linha azul mostra o valor de mercado. A tracejada mostra quanto foi investido." />
          <History points={history || []} />
        </Card>

        <Card>
          <InvestmentCardHeader title="Próximo aporte"
            description={`Sugestão para um aporte de ${brl(plan.contribution)}.`} />
          <div className="flex flex-col gap-3 px-5 pb-5 sm:px-6 sm:pb-6">
            {plan.orders.length === 0 && (
              <p className="py-8 text-center text-[14px] text-subtle">
                Defina o aporte mensal para ver a sugestão.</p>
            )}
            {plan.orders.slice(0, 5).map((order) => (
              <div key={order.ticker}
                className="flex items-center justify-between gap-3 rounded-xl
                  border border-border/70 bg-surface2/45 px-4 py-3">
                <div>
                  <p className="text-[15px] font-bold text-strong">{order.ticker}</p>
                  {order.quantity > 0 && (
                    <p className="tnum mt-1 text-[13px] text-subtle">
                      {order.quantity.toLocaleString('pt-BR')} ×{' '}
                      {brl(order.price)}</p>
                  )}
                </div>
                <span className="tnum text-[16px] font-semibold text-brand-soft">
                  <SensitiveAmount>{brl(order.amount)}</SensitiveAmount></span>
              </div>
            ))}
            {plan.leftover > 0.01 && (
              <p className="text-[14px] text-subtle">
                Restam {brl(plan.leftover)} porque o valor não completa um lote.</p>
            )}
            <button onClick={() => goTab('aporte')}
              className="mt-1 min-h-10 self-start text-[14px] font-bold text-brand
                hover:underline">
              Simular no Aporte →
            </button>
          </div>
        </Card>
      </div>

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1.55fr)_minmax(340px,.7fr)]">
        <Card>
          <InvestmentCardHeader title="Alocação da carteira"
            description="A barra azul mostra a alocação atual. O marcador branco indica o objetivo." />
          <div className="px-5 pb-6 sm:px-6">
            <div className="mb-3 hidden grid-cols-[150px_1fr_88px_88px_88px] gap-4
              px-3 text-[13px] font-bold text-secondary sm:grid">
              <span>Classe</span><span>Distribuição</span>
              <span className="text-right">Atual</span>
              <span className="text-right">Objetivo</span>
              <span className="text-right">Desvio</span>
            </div>
            <div className="flex flex-col gap-2">
              {counted.map((item) => (
                <div key={item.node} className="grid grid-cols-[1fr_auto] items-center
                  gap-x-4 gap-y-3 rounded-xl px-3 py-3 hover:bg-surface2/45
                  sm:grid-cols-[150px_1fr_88px_88px_88px]">
                  <span className="text-[15px] font-bold text-strong">{item.name}</span>
                  <div className="order-3 col-span-2 sm:order-none sm:col-span-1">
                    <DriftBar real={item.real_pct} target={item.target_pct} />
                  </div>
                  <span className="tnum hidden text-right text-[15px] text-secondary sm:block">
                    {pct(item.real_pct)}</span>
                  <span className="tnum hidden text-right text-[15px] text-secondary sm:block">
                    {pct(item.target_pct)}</span>
                  <div className="justify-self-end"><DriftChip drift={item.drift} /></div>
                </div>
              ))}
            </div>
          </div>
          {outsideStrategy.length > 0 && (
            <div className="border-t border-border bg-surface2/25 px-5 py-5 sm:px-6">
              <h4 className="text-[16px] font-bold text-strong">Fora da estratégia</h4>
              <p className="mt-1 text-[14px] text-secondary">
                Estes valores fazem parte do patrimônio, mas não recebem aporte automático.</p>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                {outsideStrategy.map((item) => (
                  <div key={item.node} className="rounded-xl border border-border/70
                    bg-surface/70 px-4 py-3">
                    <p className="text-[13px] text-subtle">{item.name}</p>
                    <p className="tnum mt-1 text-[16px] font-semibold text-strong">
                      <Money value={item.value} /></p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </Card>

        <PortfolioComposition allocation={allocation} policy={data.policy || []} />
      </div>
    </div>
  )
}
