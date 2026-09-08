import { useMemo, useState } from 'react'
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts'
import { ArrowDown, ArrowUp, Plus, RotateCcw, Save, Trash2 } from 'lucide-react'

import { Button, Card } from '../ui/primitives.jsx'
import { inputCls } from '../ui/MultiSelect.jsx'
import {
  InvestmentCardHeader, InvestmentPageHeader, Money, pct,
} from './shared.jsx'

// Paleta categórica validada (contraste, separação para daltonismo) contra o fundo
// escuro do app — não é a mesma do donut de Composição, que ainda não passa nessa
// validação; ajustar aquela é fora do escopo desta tela.
const PALETTE = ['#3987e5', '#d95926', '#199e70', '#c98500',
                 '#d55181', '#008300', '#9085e9', '#e66767']
// "Livre" nunca disputa cor com uma linha: é sempre esse cinza neutro, já usado
// no app para "sem teto definido" — leitura de "ainda não decidido".
const FREE_COLOR = '#5d6b7a'

function colorFor(id) {
  const hash = [...String(id)].reduce((total, ch) => total + ch.charCodeAt(0), 0)
  return PALETTE[hash % PALETTE.length]
}

const parseNum = (v) => {
  const n = Number(String(v ?? '').replace(',', '.'))
  return Number.isFinite(n) ? n : 0
}

let seq = 0
const newId = () => `row-${Date.now()}-${seq++}`

function rowsFromServer(items) {
  return (items || []).map((item) => ({
    id: newId(), label: item.label || '', amountInput: String(item.amount ?? ''),
  }))
}

export function Simulador({ data, onApply, busy }) {
  const sim = data.allocation_sim || { base: null, items: [] }
  const liveBase = data.wealth?.to_invest || 0

  const [rows, setRows] = useState(() => rowsFromServer(sim.items))
  const [followLive, setFollowLive] = useState(sim.base == null)
  const [baseInput, setBaseInput] = useState(
    () => String(sim.base ?? liveBase))

  const baseNumber = followLive ? liveBase : parseNum(baseInput)
  const labelOptions = useMemo(() => [...new Set(
    (data.positions || []).map((p) => p.name).filter(Boolean))].sort(), [data.positions])

  const setRow = (id, field, value) => setRows((current) =>
    current.map((r) => (r.id === id ? { ...r, [field]: value } : r)))
  const addRow = () => setRows((current) =>
    [...current, { id: newId(), label: '', amountInput: '' }])
  const removeRow = (id) => setRows((current) => current.filter((r) => r.id !== id))
  const moveRow = (id, dir) => setRows((current) => {
    const i = current.findIndex((r) => r.id === id)
    const j = i + dir
    if (i < 0 || j < 0 || j >= current.length) return current
    const next = [...current]
    ;[next[i], next[j]] = [next[j], next[i]]
    return next
  })

  const parsed = rows.map((r) => ({ ...r, amount: parseNum(r.amountInput) }))
  const spent = parsed.reduce((sum, r) => sum + r.amount, 0)
  const livre = baseNumber - spent
  let acc = 0
  const withRunning = parsed.map((r) => {
    acc += r.amount
    return { ...r, restante: baseNumber - acc,
      relPct: baseNumber ? r.amount / baseNumber : 0 }
  })

  const slices = [
    ...parsed.filter((r) => r.label && r.amount > 0)
      .map((r) => ({ name: r.label, value: r.amount, fill: colorFor(r.id) })),
    ...(livre > 0.005
      ? [{ name: 'Livre', value: livre, fill: FREE_COLOR }] : []),
  ]
  const chartTotal = slices.reduce((sum, s) => sum + s.value, 0)

  const savedSnapshot = useMemo(() => JSON.stringify({
    base: sim.base ?? null,
    items: (sim.items || []).map((it) => ({ label: it.label, amount: it.amount })),
  }), [sim])
  const currentSnapshot = JSON.stringify({
    base: followLive ? null : baseNumber,
    items: parsed.filter((r) => r.label.trim())
      .map((r) => ({ label: r.label.trim(), amount: r.amount })),
  })
  const dirty = savedSnapshot !== currentSnapshot

  const reset = () => {
    setRows(rowsFromServer(sim.items))
    setFollowLive(sim.base == null)
    setBaseInput(String(sim.base ?? liveBase))
  }
  const save = () => onApply({ allocation_sim: JSON.parse(currentSnapshot) })

  return (
    <div className="flex flex-col gap-6">
      <InvestmentPageHeader eyebrow="Rascunho, não vira trade"
        title="Simulador de alocação"
        description="Divida um valor livremente entre nomes que você escolhe — caixinha, ativo ou algo que ainda nem existe. Não mexe na política nem na carteira." />

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1.5fr)_minmax(300px,.8fr)]">
        <Card>
          <InvestmentCardHeader title="Linhas"
            description="A ordem decide o Restante — o Livre no fim não muda com a ordem."
            right={
              <span className="flex flex-wrap gap-2">
                {dirty && (
                  <Button variant="ghost" onClick={reset}>
                    <RotateCcw className="size-4" /> Descartar</Button>
                )}
                <Button variant="primary" onClick={save} disabled={!dirty || busy}>
                  <Save className="size-4" /> Salvar</Button>
              </span>
            } />

          <div className="px-5 pb-3 sm:px-6">
            <label className="mb-2 block text-[13px] text-secondary">Base a distribuir</label>
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex min-h-12 items-center gap-2 rounded-2xl border
                border-border bg-surface2 px-4">
                <span className="text-[14px] text-secondary">R$</span>
                <input value={followLive ? String(liveBase) : baseInput} inputMode="decimal"
                  disabled={followLive}
                  onChange={(e) => { setFollowLive(false); setBaseInput(e.target.value) }}
                  className="tnum min-w-0 w-40 bg-transparent text-[20px]
                    font-bold outline-none disabled:text-secondary" />
              </div>
              {!followLive && (
                <button onClick={() => setFollowLive(true)}
                  className="text-[12px] font-semibold text-brand-soft hover:underline">
                  usar o valor a aportar ao vivo (<Money value={liveBase} />)
                </button>
              )}
              {followLive && (
                <span className="text-[12px] text-subtle">
                  acompanhando o "a aportar" da carteira
                </span>
              )}
            </div>
          </div>

          <datalist id="alloc-sim-labels">
            {labelOptions.map((name) => <option key={name} value={name} />)}
          </datalist>

          <div className="overflow-x-auto px-2 pb-2 sm:px-3">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wide text-subtle">
                  <th className="px-3 py-2">Item</th>
                  <th className="px-3 py-2 text-right">Custo</th>
                  <th className="px-3 py-2 text-right">Restante</th>
                  <th className="px-3 py-2 text-right">% relativo</th>
                  <th className="w-24" />
                </tr>
              </thead>
              <tbody>
                {withRunning.map((r, i) => (
                  <tr key={r.id} className="border-t border-border/60">
                    <td className="px-3 py-1.5">
                      <span className="mr-2 inline-block size-2.5 rounded-full"
                        style={{ background: colorFor(r.id) }} />
                      <input value={r.label} list="alloc-sim-labels"
                        placeholder="nome livre…"
                        onChange={(e) => setRow(r.id, 'label', e.target.value)}
                        className={inputCls('inline-block w-40')} />
                    </td>
                    <td className="px-3 py-1.5 text-right">
                      <input value={r.amountInput} inputMode="decimal"
                        placeholder="0" onChange={(e) =>
                          setRow(r.id, 'amountInput', e.target.value)}
                        className={inputCls('tnum w-28 text-right')} />
                    </td>
                    <td className={`tnum px-3 py-1.5 text-right font-semibold
                      ${r.restante < 0 ? 'text-red' : 'text-secondary'}`}>
                      <Money value={r.restante} />
                    </td>
                    <td className="tnum px-3 py-1.5 text-right text-subtle">
                      {pct(r.relPct)}
                    </td>
                    <td className="px-3 py-1.5">
                      <div className="flex items-center justify-end gap-0.5">
                        <button onClick={() => moveRow(r.id, -1)} disabled={i === 0}
                          className="rounded-lg p-1 text-subtle hover:bg-surface2
                            disabled:opacity-30" title="Mover pra cima">
                          <ArrowUp className="size-3.5" />
                        </button>
                        <button onClick={() => moveRow(r.id, 1)}
                          disabled={i === withRunning.length - 1}
                          className="rounded-lg p-1 text-subtle hover:bg-surface2
                            disabled:opacity-30" title="Mover pra baixo">
                          <ArrowDown className="size-3.5" />
                        </button>
                        <button onClick={() => removeRow(r.id)}
                          className="rounded-lg p-1 text-red hover:bg-red/10"
                          title="Remover">
                          <Trash2 className="size-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                <tr className="border-t border-border bg-surface2/40 font-bold">
                  <td className="px-3 py-2 text-secondary">
                    <span className="mr-2 inline-block size-2.5 rounded-full"
                      style={{ background: FREE_COLOR }} />Livre</td>
                  <td />
                  <td className={`tnum px-3 py-2 text-right
                    ${livre < 0 ? 'text-red' : 'text-strong'}`}>
                    <Money value={livre} /></td>
                  <td className="tnum px-3 py-2 text-right text-subtle">
                    {pct(baseNumber ? livre / baseNumber : 0)}</td>
                  <td />
                </tr>
              </tbody>
            </table>
          </div>

          <div className="px-5 pb-5 sm:px-6">
            <Button variant="ghost" onClick={addRow}>
              <Plus className="size-4" /> Nova linha
            </Button>
            {livre < -0.005 && (
              <p className="mt-3 rounded-xl border border-red/30 bg-red/10 px-3 py-2
                text-[13px] text-red">
                Você alocou <Money value={-livre} /> a mais do que a base — o
                gráfico não mostra esse excesso.
              </p>
            )}
          </div>
        </Card>

        <Card className="order-first p-5 xl:order-none sm:p-6">
          <h3 className="text-[15px] font-bold text-strong">Como ficou</h3>
          {chartTotal > 0 ? (
            <div className="relative mt-2 h-[220px] min-w-0" role="img"
              aria-label="Gráfico da divisão simulada">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={slices} dataKey="value" nameKey="name"
                    innerRadius={64} outerRadius={94} paddingAngle={2}
                    stroke="var(--color-surface)" strokeWidth={3}>
                    {slices.map((s) => <Cell key={s.name} fill={s.fill} />)}
                  </Pie>
                  <Tooltip content={({ active, payload }) => active && payload?.length ? (
                    <div className="rounded-xl border border-border bg-surface2/95
                      px-3 py-2 text-[13px] shadow-xl">
                      <p className="font-bold text-strong">{payload[0].name}</p>
                      <p className="tnum mt-1 text-secondary">
                        <Money value={payload[0].value} /> ·{' '}
                        {pct(payload[0].value / chartTotal)}</p>
                    </div>
                  ) : null} />
                </PieChart>
              </ResponsiveContainer>
              <div className="pointer-events-none absolute inset-0 grid place-content-center
                text-center">
                <p className="text-[11px] font-semibold text-subtle">Base</p>
                <p className="tnum mt-1 text-[16px] font-bold text-strong">
                  <Money value={baseNumber} /></p>
              </div>
            </div>
          ) : (
            <p className="mt-6 py-8 text-center text-[13px] text-subtle">
              Defina uma base e ao menos uma linha com valor pra ver o gráfico.
            </p>
          )}
          <div className="mt-4 flex flex-col gap-1.5 border-t border-border/70 pt-4">
            {slices.map((s) => (
              <div key={s.name} className="flex items-center justify-between text-[13px]">
                <span className="flex items-center gap-2 text-secondary">
                  <span className="size-2.5 rounded-full" style={{ background: s.fill }} />
                  {s.name}
                </span>
                <span className="tnum text-subtle">{pct(s.value / chartTotal)}</span>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  )
}
