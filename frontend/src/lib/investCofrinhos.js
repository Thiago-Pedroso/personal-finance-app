// Cofrinhos e caixinhas fora do Open Finance: saldo informado à mão (valuation
// `balance`). Aqui ficam as contas puras da tela de Reservas: idade do último saldo e o
// agrupamento das sugestões de ligação vindas do relatório (`link_suggestions`).

// Saldo manual mais velho que isso pede atualização
export const STALE_DAYS = 30

const DAY = 24 * 60 * 60 * 1000

export function balanceAgeDays(position, today = new Date()) {
  if (!position?.last_balance_date) return null
  const [y, m, d] = position.last_balance_date.split('-').map(Number)
  const then = Date.UTC(y, m - 1, d)
  const now = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate())
  return Math.max(0, Math.round((now - then) / DAY))
}

// Só saldo informado à mão envelhece: conta e ativo da Pluggy atualizam no sync
export function isStaleBalance(position, today = new Date(), days = STALE_DAYS) {
  if (position?.valuation !== 'balance') return false
  const age = balanceAgeDays(position, today)
  return age == null || age > days
}

// Agrupa as sugestões por cofrinho. Com ticker: vira `links` pronto para o apply
// (valor sempre positivo; aporte/resgate sai do sinal do lançamento no Python).
// Sem ticker: o cofrinho ainda não existe na carteira.
export function groupSuggestions(suggestions = []) {
  const groups = new Map()
  for (const s of suggestions) {
    const key = s.ticker || `novo:${s.account || ''}:${s.name}`
    if (!groups.has(key)) {
      groups.set(key, { key, name: s.name, ticker: s.ticker || null,
        account: s.account || null, candidates: s.candidates || [], items: [],
        in: 0, out: 0 })
    }
    const g = groups.get(key)
    g.items.push(s)
    g[s.side === 'in' ? 'in' : 'out'] += s.amount
  }
  return [...groups.values()].map((g) => ({
    ...g,
    in: Math.round(g.in * 100) / 100,
    out: Math.round(g.out * 100) / 100,
    net: Math.round((g.in - g.out) * 100) / 100,
    items: g.items.sort((a, b) => String(a.date).localeCompare(String(b.date))),
    links: g.ticker ? g.items.map((s) => ({ ledger_id: s.ledger_id,
      destinations: [{ ticker: g.ticker, amount: s.amount }] })) : [],
  })).sort((a, b) => (a.ticker ? 0 : 1) - (b.ticker ? 0 : 1)
    || a.name.localeCompare(b.name, 'pt-BR'))
}
