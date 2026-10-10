const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
const BRL0 = new Intl.NumberFormat('pt-BR', {
  style: 'currency', currency: 'BRL', maximumFractionDigits: 0,
})
const NUM = new Intl.NumberFormat('pt-BR')
const MES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun',
             'jul', 'ago', 'set', 'out', 'nov', 'dez']

const FOREIGN = new Map()
// saldo em moeda estrangeira aparece na moeda dele ao lado do valor em reais
export const money = (n, currency = 'BRL') => {
  if (!currency || currency === 'BRL') return BRL.format(n || 0)
  if (!FOREIGN.has(currency)) {
    FOREIGN.set(currency, new Intl.NumberFormat('pt-BR', {
      style: 'currency', currency, currencyDisplay: 'narrowSymbol',
    }))
  }
  return FOREIGN.get(currency).format(n || 0)
}

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
const MONTH_NAMES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho',
  'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro']
export const monthShort = (index) => MES[index]
// '2026-10' -> 'Outubro de 2026'; ano (YYYY) passa direto
export const monthLong = (m) => {
  if (!m) return ''
  if (m.length === 4) return m
  const [y, mm] = m.split('-')
  return `${MONTH_NAMES[+mm - 1]} de ${y}`
}
// tempo desde um instante ISO, em português: 'agora', 'há 5 min', 'há 2 h', 'há 3 dias'
export const timeAgo = (iso, now = Date.now()) => {
  const minutes = Math.max(0, Math.round((now - new Date(iso).getTime()) / 60000))
  if (minutes < 1) return 'agora'
  if (minutes < 60) return `há ${minutes} min`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `há ${hours} h`
  const days = Math.round(hours / 24)
  return days === 1 ? 'há 1 dia' : `há ${days} dias`
}
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

const CORPORATE = /(^|\s)(INSTITUI[CÇ][AÃ]O DE PAGAMENTO|S\.?\/?A\.?|LTDA\.?|EIRELI)(?=\s|$)/gi
const titleWord = (word) => word.length <= 3 ? word
  : word[0] + word.slice(1).toLowerCase()
// nome de conta legível: sem sufixo societário nem parênteses, e sem caixa alta gritada
export const shortAccount = (name) => {
  if (!name) return ''
  const base = name.replace(/\(.*?\)/g, '').replace(CORPORATE, ' ')
    .replace(/\s+/g, ' ').replace(/[\s,.\-–]+$/, '').trim()
  if (!base) return name
  return base === base.toUpperCase() ? base.split(' ').map(titleWord).join(' ') : base
}
