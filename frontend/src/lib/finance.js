// Cálculo puro das mini-ferramentas — sem rede, testável. A UI consome isto ao vivo.
// (Espelhável em finance/tools.py depois, se quiser rodar as mesmas contas na conversa.)

// Presets de taxa anual (%) — referência jun/2026 (Selic 14,25% a.a., Copom 17/06/2026),
// EDITÁVEIS. A Poupança é travada em ~0,5% a.m. (6,17%/ano) quando a Selic passa de 8,5%.
// Atualizar quando a Selic mudar (ou pedir a taxa atual pro Claude).
export const RATE_PRESETS = [
  { key: 'poupanca', label: 'Poupança', rate: 6.17 },
  { key: 'cdi', label: 'CDI/Selic', rate: 14.25 },
  { key: 'ipca', label: 'IPCA+', rate: 11.5 },
]
export const DEFAULT_INFLATION = 4.5

// ---- Auditor de recorrentes: anualiza pela cadência e ranqueia ----
const PER_YEAR = { semanal: 52, quinzenal: 26, mensal: 12, bimestral: 6, anual: 1 }

export function auditRecurring(recurring = []) {
  const items = recurring.map((r) => {
    const perYear = PER_YEAR[r.cadence] || 12
    const yearly = (r.amount || 0) * perYear
    return {
      label: r.label, category: r.category, cadence: r.cadence,
      amount: r.amount || 0, monthly: yearly / 12, yearly,
    }
  }).sort((a, b) => b.yearly - a.yearly)
  const totalYearly = items.reduce((a, i) => a + i.yearly, 0)
  return { items, totalYearly, totalMonthly: totalYearly / 12 }
}

// ---- Reserva de emergência: quantos meses o colchão cobre ----
export function emergencyReserve({ gastosMedios = 0, saldo = 0, targetMonths = 6 }) {
  const months = gastosMedios > 0 ? saldo / gastosMedios : 0
  const target = targetMonths * gastosMedios
  const missing = Math.max(0, target - saldo)
  const pct = target > 0 ? Math.min((saldo / target) * 100, 100) : 0
  const status = months >= targetMonths ? 'ok'
    : months >= targetMonths * 0.5 ? 'quase' : 'baixo'
  return { months, target, missing, pct, status }
}

// ---- Taxa de poupança: % da renda que sobra por mês, média e tendência ----
// Usa taxa AGREGADA (Σsaldo / Σrenda) — robusta a meses parciais com renda ínfima,
// que num cálculo mês-a-mês explodiriam (ex.: renda R$0,14 → milhares de %).
export function savingsRateSeries(months = [], window = 12) {
  const win = months.slice(-window)
  const aggRate = (arr) => {
    const inc = arr.reduce((a, m) => a + (m.income || 0), 0)
    return inc > 0 ? (arr.reduce((a, m) => a + (m.net || 0), 0) / inc) * 100 : 0
  }
  // só considera mês "com renda relevante" (>= 15% da mediana) na série por mês
  const incomes = win.map((m) => m.income || 0).sort((a, b) => a - b)
  const medInc = incomes.length ? incomes[Math.floor(incomes.length / 2)] : 0
  const rows = win.map((m) => ({
    month: m.month,
    rate: m.income > 0 && m.income >= 0.15 * medInc ? (m.net / m.income) * 100 : null,
  }))
  const valid = rows.filter((r) => r.rate != null)
  const half = Math.floor(win.length / 2)
  return {
    rows,
    avg: aggRate(win),
    current: valid.length ? valid[valid.length - 1].rate : aggRate(win),
    trend: win.length > 1 ? aggRate(win.slice(half)) - aggRate(win.slice(0, half)) : 0,
  }
}

// Projeção de patrimônio mês a mês com aporte mensal e step-up anual opcional.
export function projectWealth({
  initial = 0, monthly = 0, annualRate = 10, years = 15,
  stepUpPct = 0, inflationPct = DEFAULT_INFLATION,
}) {
  const months = Math.max(1, Math.round(years * 12))
  const mRate = Math.pow(1 + annualRate / 100, 1 / 12) - 1
  let balance = initial
  let contributed = initial
  let contribution = monthly
  let crossoverMonth = null
  const series = [{ m: 0, balance, contributed, interest: 0 }]
  for (let i = 1; i <= months; i++) {
    const interestThis = balance * mRate
    // "ponto de virada": mês em que o juro do mês supera o aporte do mês
    if (crossoverMonth == null && contribution > 0 && interestThis >= contribution)
      crossoverMonth = i
    balance = balance + interestThis + contribution
    contributed += contribution
    series.push({ m: i, balance, contributed, interest: Math.max(0, balance - contributed) })
    if (i % 12 === 0 && stepUpPct) contribution *= (1 + stepUpPct / 100)
  }
  return {
    finalBalance: balance,
    contributed,
    interest: Math.max(0, balance - contributed),
    interestPerMonth: balance * mRate,     // juro do último mês
    crossoverMonth,                        // em meses (ou null se não vira no prazo)
    realValue: balance / Math.pow(1 + inflationPct / 100, years), // poder de compra de hoje
    series,
  }
}
