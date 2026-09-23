const tradeTotal = (trade) => {
  const quantity = Number(trade.quantity) || 0
  const price = Number(trade.price) || 0
  const rate = Number(trade.fx_rate) || 1
  const gross = (quantity > 0 ? quantity * price : price) * rate
  return trade.side === 'BUY' ? gross + (Number(trade.fees) || 0) : gross
}

function balanceLabel(trade) {
  if ((trade.note || '').includes('rateado')) return 'Rendimento rateado'
  return trade.source === 'pluggy' ? 'Saldo da instituição' : 'Saldo informado'
}

// Linha do tempo de uma caixinha ou conta: o que entrou, saiu e rendeu, de onde veio cada
// valor e o saldo depois de cada passo. Numa caixinha, saldo informado aparece pela
// variação (rendimento); numa conta, pelo próprio saldo, porque a variação mistura tudo.
export function envelopeHistory(ticker, trades, links, { account = false } = {}) {
  const origins = Object.fromEntries((links || []).map((link) => [link.ledger_id, link]))
  const ordered = [...(trades || [])].sort((a, b) =>
    (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
  const rows = []
  let balance = 0
  let opened = false
  for (const trade of ordered) {
    const origin = trade.ledger_id ? origins[trade.ledger_id] || null : null
    if (trade.ticker !== ticker) continue
    const base = { id: trade.id, date: trade.date, origin }
    if (trade.side === 'TRANSFER') {
      rows.push({ ...base, kind: 'in', label: 'Chegou do Fluxo',
        amount: Number(trade.price) || 0, balance: null })
      continue
    }
    if (trade.side === 'BALANCE') {
      const informed = Number(trade.price) || 0
      const delta = informed - balance
      if (account) {
        rows.push({ ...base, kind: 'balance', label: 'Saldo da instituição',
          amount: informed, balance: null })
        balance = informed
        continue
      }
      if (opened && Math.abs(delta) < 0.005) continue
      rows.push({ ...base, kind: opened ? (delta >= 0 ? 'in' : 'out') : 'balance',
        label: opened ? balanceLabel(trade) : 'Saldo de abertura',
        amount: opened ? Math.abs(delta) : informed, balance: informed })
      balance = informed
      opened = true
      continue
    }
    if (!['BUY', 'SELL', 'DIVIDEND', 'JCP'].includes(trade.side)) continue
    const amount = tradeTotal(trade)
    const entering = trade.side !== 'SELL'
    const label = trade.side === 'BUY' ? 'Entrada'
      : trade.side === 'SELL' ? 'Saída' : 'Provento'
    balance += entering ? amount : -amount
    opened = true
    rows.push({ ...base, kind: entering ? 'in' : 'out', label, amount, balance })
  }
  return rows.reverse()
}

// Quantas entradas do envelope vieram de lançamentos do Fluxo.
export function linkedCount(ticker, links) {
  return (links || []).filter((link) =>
    (link.links || []).some((item) => item.ticker === ticker)).length
}
