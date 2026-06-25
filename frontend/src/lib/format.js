const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
const BRL0 = new Intl.NumberFormat('pt-BR', {
  style: 'currency', currency: 'BRL', maximumFractionDigits: 0,
})
const NUM = new Intl.NumberFormat('pt-BR')
const MES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun',
             'jul', 'ago', 'set', 'out', 'nov', 'dez']

export const brl = (n) => BRL.format(n || 0)
export const brl0 = (n) => BRL0.format(n || 0)
export const num = (n) => NUM.format(n || 0)
export const signedBrl = (n) =>
  (n > 0 ? '+' : n < 0 ? '−' : '') + BRL.format(Math.abs(n || 0))

export const monthLabel = (m) => {
  if (!m) return ''
  if (m.length === 4) return m            // ano (YYYY)
  const [y, mm] = m.split('-')
  return `${MES[+mm - 1]}/${y}`
}
export const monthShortY = (m) => `${MES[+m.split('-')[1] - 1]}/${m.slice(2, 4)}`
export const dayMonth = (d) => {
  const [, mm, dd] = d.split('-')
  return `${dd}/${mm}`
}
export const fullDate = (d) => {
  const [y, mm, dd] = d.split('-')
  return `${dd}/${mm}/${y}`
}
const WD = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb']
// '2026-03-20' -> 'sex, 20/03/2026'
export const longDate = (d) => {
  const [y, mm, dd] = d.split('-').map(Number)
  return `${WD[new Date(y, mm - 1, dd).getDay()]}, ${fullDate(d)}`
}
export const pctDelta = (cur, prev) =>
  !prev ? null : ((cur - prev) / Math.abs(prev)) * 100
export const fmtPct = (p) =>
  p == null ? '—' : `${p > 0 ? '+' : ''}${p.toFixed(0)}%`
