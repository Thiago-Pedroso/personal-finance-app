import { useEffect, useState } from 'react'
import { Car, Home, Landmark, Package, Plus, RefreshCw, Trash2, TriangleAlert } from 'lucide-react'
import { useInvest } from '../lib/useInvest.js'
import { postWealthManual } from '../lib/api.js'
import { brl, fullDate } from '../lib/format.js'
import { Button, Card, CardHead, Spinner } from './ui/primitives.jsx'
import { inputCls } from './ui/MultiSelect.jsx'
import { SensitiveAmount, SensitiveMoneyInput } from './ui/SensitiveValue.jsx'
import { WEALTH_SERIES, WealthStackChart } from './charts.jsx'

// Patrimônio = carteira (invest.json `wealth`, por papel do nó) + bens informados à mão
// − dívidas (fatura em aberto do Open Finance + dívidas informadas à mão). O histórico
// vem do InvestSnapshots; as dívidas ainda não têm histórico, então a linha do líquido
// usa a dívida de hoje.

const ASSET_KINDS = [['veiculo', 'Veículo', Car], ['imovel', 'Imóvel', Home],
  ['outro', 'Outro', Package]]
const DEBT_KINDS = [['emprestimo', 'Empréstimo', Landmark],
  ['financiamento', 'Financiamento', Home], ['outro', 'Outro', Package]]

function Line({ label, hint, value, tone = 'text-strong', children }) {
  return (
    <div className="min-w-0" title={hint}>
      <p className="text-[12.5px] text-subtle">{label}</p>
      <p className={`tnum mt-0.5 truncate text-[17px] font-semibold ${tone}`}>
        <SensitiveAmount>{brl(value)}</SensitiveAmount></p>
      {children}
    </div>
  )
}

function SubList({ items }) {
  if (!items?.length) return null
  return (
    <ul className="mt-1 flex flex-col gap-0.5 text-[12px] text-faint">
      {items.map((it) => (
        <li key={it.key} className="flex justify-between gap-3">
          <span className="truncate">{it.name}</span>
          <SensitiveAmount className="tnum shrink-0">{brl(it.value)}</SensitiveAmount>
        </li>
      ))}
    </ul>
  )
}

const blank = (kind) => ({ name: '', value: '', kind, as_of: '', note: '' })

function ManualEditor({ manual, onSaved }) {
  const [draft, setDraft] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => { setDraft(null) }, [manual])
  const data = draft || { assets: manual.assets || [], debts: manual.debts || [] }
  const dirty = draft != null
  const edit = (list, i, patch) => setDraft({ ...data,
    [list]: data[list].map((it, j) => (j === i ? { ...it, ...patch } : it)) })
  const add = (list, kind) => setDraft({ ...data, [list]: [...data[list], blank(kind)] })
  const del = (list, i) => setDraft({ ...data,
    [list]: data[list].filter((_, j) => j !== i) })
  const save = async () => {
    setBusy(true); setError('')
    try {
      const clean = (rows) => rows.filter((r) => String(r.name).trim())
        .map((r) => ({ ...r, value: Number(r.value) || 0 }))
      await postWealthManual({ assets: clean(data.assets), debts: clean(data.debts) })
      await onSaved()
    } catch (e) { setError(e.message) } finally { setBusy(false) }
  }

  const section = (list, title, kinds, hint) => (
    <div>
      <div className="flex items-center justify-between gap-2">
        <p className="text-[13px] font-semibold">{title}</p>
        <Button variant="ghost" onClick={() => add(list, kinds[0][0])}>
          <Plus className="size-4" /> Adicionar</Button>
      </div>
      {data[list].length === 0 && <p className="mt-1 text-[12.5px] text-faint">{hint}</p>}
      <ul className="mt-2 flex flex-col gap-2">
        {data[list].map((it, i) => (
          <li key={it.id || `new-${i}`} className="grid grid-cols-2 gap-2 rounded-xl border
            border-border/70 bg-bg/30 p-2.5 sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,0.9fr)_minmax(0,0.9fr)_auto]">
            <input value={it.name} placeholder="Nome" aria-label="Nome"
              onChange={(e) => edit(list, i, { name: e.target.value })}
              className={inputCls('col-span-2 min-w-0 sm:col-span-1')} />
            <SensitiveMoneyInput value={it.value} placeholder="Valor (R$)" min="0" step="0.01"
              aria-label="Valor" onChange={(e) => edit(list, i, { value: e.target.value })}
              className={inputCls('min-w-0')} />
            <select value={it.kind} aria-label="Tipo"
              onChange={(e) => edit(list, i, { kind: e.target.value })}
              className={inputCls('min-w-0')}>
              {kinds.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
            <input type="date" value={it.as_of || ''} aria-label="Data do valor"
              onChange={(e) => edit(list, i, { as_of: e.target.value })}
              className={inputCls('min-w-0')} />
            <button onClick={() => del(list, i)} aria-label="Remover"
              className="grid place-items-center rounded-lg px-2 text-muted hover:text-red">
              <Trash2 className="size-4" /></button>
          </li>
        ))}
      </ul>
    </div>
  )

  return (
    <Card>
      <CardHead title="Bens e dívidas informados à mão"
        sub="O que não tem cotação nem aparece no Open Finance. Fica no Config[wealth_manual]." />
      <div className="flex flex-col gap-5 px-5 pb-5">
        {section('assets', 'Bens', ASSET_KINDS, 'Carro, imóvel, outros bens pelo valor de hoje.')}
        {section('debts', 'Dívidas', DEBT_KINDS,
          'Empréstimo, financiamento: o saldo devedor de hoje.')}
        {manual.error && <p className="text-[12.5px] text-red">Config inválido: {manual.error}</p>}
        {error && <p className="text-[12.5px] text-red">{error}</p>}
        {dirty && (
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setDraft(null)} disabled={busy}>
              Descartar</Button>
            <Button variant="primary" onClick={save} disabled={busy}>
              {busy ? <Spinner /> : null} Salvar</Button>
          </div>
        )}
      </div>
    </Card>
  )
}

export function Patrimonio({ dash, onError }) {
  const invest = useInvest(true)
  const [withDebt, setWithDebt] = useState(true)
  useEffect(() => { if (invest.error) onError?.(invest.error) }, [invest.error, onError])

  if (!invest.data) {
    return invest.error ? (
      <Card className="px-6 py-12 text-center text-[13px] text-muted">
        Sem carteira ainda: rode <code className="rounded bg-white/10 px-1.5">uv run python
        -m finance.invest report</code>.</Card>
    ) : (
      <div className="flex items-center gap-2 py-20 text-muted justify-center">
        <Spinner /> Carregando patrimônio…</div>
    )
  }
  const data = invest.data
  const w = data.wealth || { invested: 0, reserved: 0, to_invest: 0, free: 0, total: 0 }
  const manual = data.manual_wealth || { assets: [], debts: [], assets_total: 0,
    debts_total: 0 }
  const card = data.debts || { items: [], total: 0 }
  const inst = dash?.installments?.totals
  const loans = (dash?.installments?.loans || []).filter((l) => l.status === 'active')
  const debts = (card.total || 0) + (manual.debts_total || 0)
  const gross = (w.total || 0) + (manual.assets_total || 0)
  const net = gross - debts
  const history = data.wealth_history || []

  return (
    <div className="flex flex-col gap-4">
      <Card className="p-5 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-[15px] font-bold text-secondary">
            {withDebt ? 'Patrimônio líquido' : 'Patrimônio bruto'}</p>
          <div className="flex rounded-full border border-border/70 p-0.5 text-[12.5px]">
            {[[true, 'Com dívida'], [false, 'Sem dívida']].map(([value, label]) => (
              <button key={label} type="button" onClick={() => setWithDebt(value)}
                aria-pressed={withDebt === value}
                className={`rounded-full px-3 py-1 transition ${withDebt === value
                  ? 'bg-white/[0.08] font-semibold text-strong'
                  : 'text-subtle hover:text-secondary'}`}>{label}</button>
            ))}
          </div>
        </div>
        <p className={`tnum mt-2 text-[30px] font-bold tracking-[-0.03em] sm:text-[36px] ${
          (withDebt ? net : gross) < 0 ? 'text-red' : 'text-strong'}`}>
          <SensitiveAmount>{brl(withDebt ? net : gross)}</SensitiveAmount></p>
        <div className="mt-5 grid grid-cols-2 gap-x-4 gap-y-4 border-t border-border/70 pt-5
          md:grid-cols-3">
          <Line label="Investido" hint="na estratégia" value={w.invested} />
          <Line label="Reservado" hint="guardado com destino (caixinhas, reserva)"
            value={w.reserved} />
          <Line label="A aportar" hint="na corretora, ainda não virou posição"
            value={w.to_invest} />
          <Line label="Livre" hint="contas sem compromisso" value={w.free} />
          <Line label="Bens" hint="informados à mão" value={manual.assets_total}>
            <SubList items={manual.assets.map((a) => ({ key: a.id, name: a.name,
              value: a.value }))} />
          </Line>
          <Line label="Dívidas" hint="fatura em aberto + dívidas informadas" value={-debts}
            tone="text-red">
            <SubList items={[
              ...card.items.map((d) => ({ key: d.account_id || d.name, name: d.name,
                value: d.balance })),
              ...manual.debts.map((d) => ({ key: d.id, name: d.name, value: d.value })),
            ]} />
          </Line>
        </div>
        {(inst?.remaining_amount > 0 || loans.length > 0) && (
          <p className="mt-4 border-t border-border/70 pt-3 text-[12.5px] text-muted">
            {inst?.remaining_amount > 0 && <>Das dívidas de cartão,{' '}
              <SensitiveAmount className="tnum font-semibold text-text">
                {brl(inst.remaining_amount)}</SensitiveAmount> são parcelas futuras de
              compras (aba <a href="#/financas/installments" className="text-brand-soft
                hover:underline">Parcelas</a>), já incluídas no limite usado. </>}
            {loans.length > 0 && <>{loans.length} empréstimo(s) ativo(s) sem saldo devedor
              no extrato: informe o saldo abaixo para entrar nas dívidas.</>}
          </p>
        )}
        {card.as_of && <p className="mt-2 text-[11.5px] text-faint">
          Fatura do Open Finance de {fullDate(card.as_of)} · carteira de{' '}
          {data.generated_at
            ? new Date(data.generated_at).toLocaleDateString('pt-BR') : '—'}</p>}
      </Card>

      <Card>
        <CardHead title="Evolução"
          sub="Um ponto por dia de atualização da carteira (InvestSnapshots)"
          right={<Button variant="ghost" onClick={invest.refresh} disabled={invest.busy}
            title="Recalcula a carteira e grava o snapshot do dia">
            <RefreshCw className={`size-4 ${invest.busy
              ? 'animate-[spin_.8s_linear_infinite]' : ''}`} />
            <span className="hidden sm:inline">Atualizar</span></Button>} />
        {history.length < 2 ? (
          <p className="flex items-start gap-2 px-5 pb-6 text-[13px] text-subtle">
            <TriangleAlert className="mt-0.5 size-4 shrink-0 text-amber" />
            Só {history.length} dia de histórico ({history[0] ? fullDate(history[0].date)
              : '—'}). A curva aparece a partir da próxima atualização da carteira.</p>
        ) : (
          <div className="px-2 pb-4 sm:px-4">
            <WealthStackChart points={history} debt={withDebt ? debts : 0} />
            <div className="mt-2 flex flex-wrap justify-center gap-x-4 gap-y-1 text-[12px]
              text-muted">
              {WEALTH_SERIES.map(([key, label, color]) => (
                <span key={key} className="flex items-center gap-1.5">
                  <i className="inline-block size-2 rounded-full" style={{ background: color }} />
                  {label}</span>
              ))}
            </div>
          </div>
        )}
      </Card>

      <ManualEditor manual={manual} onSaved={invest.load} />
    </div>
  )
}
