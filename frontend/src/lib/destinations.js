const DEFAULT_SUBCATEGORIES = ['Aporte', 'Resgate']

const norm = (text) => String(text || '').normalize('NFKD')
  .replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

// Quanto do lançamento é aporte ou resgate de poupança, pelas partes que estão na tela.
export function neededDestination(parts, treatments, subcategories) {
  const moving = subcategories?.length ? subcategories : DEFAULT_SUBCATEGORIES
  const total = (parts || []).reduce((sum, part) => {
    const savings = treatments?.[part.category] === 'poupança'
      && moving.includes(part.subcategory)
    return savings ? sum + Math.abs(Number(part.amount) || 0) : sum
  }, 0)
  return Math.round(total * 100) / 100
}

export function destinationBalance(rows, needed) {
  const linked = Math.round(rows.reduce((sum, row) =>
    sum + (row.ticker ? Number(row.amount) || 0 : 0), 0) * 100) / 100
  const rest = Math.round((needed - linked) * 100) / 100
  return { linked, rest, closes: Math.abs(rest) < 0.01, over: rest < -0.009 }
}

// Agrupa os envelopes por onde o dinheiro está, na ordem em que aparecem.
export function groupDestinations(destinations) {
  const groups = new Map()
  for (const item of destinations || []) {
    const key = item.account_name || item.account || 'Outros'
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(item)
  }
  return [...groups.entries()].map(([label, items]) => ({
    label, items: [...items].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')),
  }))
}

function matchScore(label, item) {
  const name = norm(item.name)
  if (!name || !label) return 0
  const similar = name.includes(label) || label.includes(name)
  if (name === label) return 2
  if (label.includes('invest') && item.role === 'to_invest') return 2
  return similar ? 1 : 0
}

// Linha do simulador que corresponde a um envelope pelo nome, para sugerir o valor.
export function simulatorSuggestions(simulator, destinations) {
  return (simulator || []).flatMap((line) => {
    const label = norm(line.label)
    const match = [...(destinations || [])]
      .map((item) => ({ item, score: matchScore(label, item) }))
      .filter(({ score }) => score > 0)
      .sort((a, b) => b.score - a.score)[0]?.item
    return match && Number(line.amount) > 0
      ? [{ ticker: match.ticker, name: match.name, amount: Number(line.amount),
        label: line.label }]
      : []
  })
}

export const STATUS_LABEL = {
  linked: 'com destino', missing: 'sem destino', partial: 'destino parcial',
  over: 'destino a mais', info: 'ligado à carteira',
}
