import { RefreshCw } from 'lucide-react'

import { useInvest } from '../../lib/useInvest.js'
import { Button, Empty, Spinner } from '../ui/primitives.jsx'
import { Aporte } from './Aporte.jsx'
import { Caixinhas } from './Caixinhas.jsx'
import { Carteira } from './Carteira.jsx'
import { Operacoes } from './Operacoes.jsx'
import { Visao } from './Visao.jsx'

export const INVEST_TABS = [
  ['visao', 'Visão Geral'],
  ['carteira', 'Carteira'],
  ['aporte', 'Aporte'],
  ['caixinhas', 'Reservas e saldo'],
  ['operacoes', 'Movimentações'],
]

export function InvestSpace({ tab, setTab, onError }) {
  const invest = useInvest(true)

  if (invest.error && !invest.data) {
    return (
      <div className="mx-auto max-w-md py-20 text-center">
        <p className="text-[14px] text-muted">
          Ainda não há carteira para mostrar.
        </p>
        <p className="mt-3 text-[13px] text-faint">
          Gere o relatório com{' '}
          <code className="rounded bg-white/10 px-1.5 py-0.5">
            uv run python -m finance.invest report</code>{' '}
          ou popule uma carteira de demonstração com{' '}
          <code className="rounded bg-white/10 px-1.5 py-0.5">
            uv run python -m finance.seed --invest</code>.
        </p>
        <Button className="mt-5" onClick={invest.load}>Tentar de novo</Button>
      </div>
    )
  }
  if (!invest.data) {
    return (
      <div className="flex h-[50vh] flex-col items-center justify-center gap-3
        text-muted">
        <Spinner className="size-6" /> Carregando a carteira…
      </div>
    )
  }

  const apply = async (payload) => {
    try {
      await invest.apply(payload)
    } catch (error) {
      onError?.(error.message)
    }
  }
  const saveTargets = (node, targets, locked) =>
    apply({ targets: { [node]: targets }, locked: { [node]: locked } })

  return (
    <>
      {invest.busy && (
        <div className="mb-3 flex items-center gap-2 text-[12px] text-muted">
          <RefreshCw className="size-3.5 animate-[spin_.8s_linear_infinite]" />
          atualizando a carteira…
        </div>
      )}
      {tab === 'visao' && <Visao data={invest.data} goTab={setTab} />}
      {tab === 'carteira' && (
        <Carteira data={invest.data} onSaveTargets={saveTargets}
          onRefresh={invest.refresh} busy={invest.busy} />
      )}
      {tab === 'aporte' && (
        <Aporte data={invest.data} onApply={apply} busy={invest.busy} />
      )}
      {tab === 'caixinhas' && (
        <Caixinhas data={invest.data} onApply={apply} busy={invest.busy} />
      )}
      {tab === 'operacoes' && (
        <Operacoes data={invest.data} onApply={apply} busy={invest.busy}
          onSync={() => invest.sync({})} />
      )}
    </>
  )
}

export function InvestPending({ data }) {
  const items = data?.pending?.pending || []
  if (!items.length) return null
  return (
    <div className="flex flex-col gap-2">
      {items.map((item, index) => (
        <div key={index} className="rounded-xl border border-amber/30 bg-amber/[0.07]
          px-4 py-3 text-[13px] text-muted">
          {item.message}
        </div>
      ))}
    </div>
  )
}

export function Empty404() {
  return <Empty>Tela não encontrada.</Empty>
}
