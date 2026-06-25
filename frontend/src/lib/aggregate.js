// Soma vários meses (agregados enxutos do dashboard.months) num único "view"
// com o mesmo formato de um mês — usado no filtro Anual.

function mergeByCategory(target, src) {
  for (const [cat, v] of Object.entries(src || {})) {
    const c = target[cat] || (target[cat] = {
      income: 0, expense: 0, count: 0, subcategories: {} })
    c.income += v.income || 0
    c.expense += v.expense || 0
    c.count += v.count || 0
    for (const [s, sv] of Object.entries(v.subcategories || {})) {
      const ss = c.subcategories[s] || (c.subcategories[s] = {
        income: 0, expense: 0, count: 0 })
      ss.income += sv.income || 0
      ss.expense += sv.expense || 0
      ss.count += sv.count || 0
    }
  }
}
function mergeMovements(target, src) {
  for (const [cat, v] of Object.entries(src || {})) {
    const c = target[cat] || (target[cat] = {
      in: 0, out: 0, count: 0, subcategories: {} })
    c.in += v.in || 0
    c.out += v.out || 0
    c.count += v.count || 0
    for (const [s, sv] of Object.entries(v.subcategories || {})) {
      const ss = c.subcategories[s] || (c.subcategories[s] = {
        in: 0, out: 0, count: 0 })
      ss.in += sv.in || 0
      ss.out += sv.out || 0
      ss.count += sv.count || 0
    }
  }
}

// monthsAgg: array de entradas dashboard.months do mesmo ano
// txns: transações concatenadas dos arquivos mensais
export function aggregateYear(year, monthsAgg, txns, savings) {
  const by_category = {}
  const movements = {}
  let income = 0, expense = 0
  for (const m of monthsAgg) {
    income += m.income || 0
    expense += m.expense || 0
    mergeByCategory(by_category, m.by_category)
    mergeMovements(movements, m.movements)
  }
  return {
    month: year,
    period: 'year',
    income: Math.round(income * 100) / 100,
    expense: Math.round(expense * 100) / 100,
    net: Math.round((income - expense) * 100) / 100,
    by_category,
    movements,
    transactions: txns,
    plan: null,
    savings: savings || null,
    insights: [],
  }
}

export const yearsOf = (months) =>
  [...new Set(months.map((m) => m.month.slice(0, 4)))].sort()
