import { useCallback, useEffect, useRef, useState } from 'react'
import { getDashboard, getMonth, getQueue, postEdit } from './api.js'
import { aggregateYear, yearsOf } from './aggregate.js'
import { setCategoryMeta } from './categories.jsx'
import { configure, drain, enqueue, subscribe } from './outbox.js'

const tagKey = (t) => String(t).trim().replace(/\s+/g, ' ').toLowerCase()

function localTags(current, add, remove) {
  const fora = new Set((remove || []).map(tagKey))
  const out = (current || []).filter((t) => !fora.has(tagKey(t)))
  const vistos = new Set(out.map(tagKey))
  for (const t of add || []) {
    const k = tagKey(t)
    if (k && !vistos.has(k)) { out.push(String(t).trim()); vistos.add(k) }
  }
  return out.sort((a, b) => tagKey(a).localeCompare(tagKey(b)))
}

function sideOf(link, txId) {
  if (link.credit_id === txId) {
    return { side: 'credit', part: link.credit_part ?? null,
      other_id: link.debit_id, other_part: link.debit_part ?? null }
  }
  if (link.debit_id === txId) {
    return { side: 'debit', part: link.debit_part ?? null,
      other_id: link.credit_id, other_part: link.credit_part ?? null }
  }
  return null
}

function localReimbursed(tx, payload) {
  const removed = new Set(payload.remove || [])
  const links = (tx.reimbursed?.links || []).filter((link) => !removed.has(link.id))
  for (const link of payload.links || []) {
    const side = sideOf(link, tx.id)
    if (!side) continue
    const other = payload.labels?.[side.other_id] || {}
    links.push({ id: `pendente-${links.length}`, amount: +link.amount, ...side,
      other_description: other.description, other_date: other.date,
      note: payload.note || null })
  }
  if (!links.length) return null
  const parts = {}
  for (const link of links) {
    if (link.part != null) parts[link.part] = (parts[link.part] || 0) + link.amount
  }
  return { amount: links.reduce((sum, link) => sum + link.amount, 0), parts, links }
}

function localInvest(tx, destinations) {
  const linked = destinations.reduce((sum, row) => sum + (Number(row.amount) || 0), 0)
  const needed = tx.invest?.needed ?? Math.abs(tx.signed_amount || 0)
  const settled = Math.abs(linked - needed) < 0.01
  return {
    needed, linked,
    status: !linked ? 'missing' : settled ? 'linked' : linked < needed ? 'partial' : 'over',
    links: destinations.map((row) => ({ ticker: row.ticker, name: row.name || row.ticker,
      amount: Number(row.amount), side: (tx.signed_amount || 0) < 0 ? 'BUY' : 'SELL' })),
  }
}

// Espelha na tela o que o backend vai gravar — só os campos visíveis do card.
// Os totais NÃO são recalculados aqui de propósito: as regras de tratamento,
// split e rasurado vivem no report.py, e duplicá-las em JS abriria espaço para
// os dois lados divergirem em silêncio. Eles chegam no refresh seguinte.
function patchOf(payload, tx) {
  const p = {}
  if (payload.mode === 'reimburse') {
    p.reimbursed = localReimbursed(tx, payload)
  } else if (payload.mode === 'tags') {
    p.tags = localTags(tx.tags, payload.tags_add, payload.tags_remove)
  } else if (payload.mode === 'split' && payload.splits?.length) {
    p.splits = payload.splits
    if (payload.note != null) p.note = payload.note
  } else {
    if (payload.category) {
      p.category = payload.category
      p.subcategory = payload.subcategory || null
      p.category_source = 'manual'
      p.reviewed = true
      p.needs_review = false
    }
    if (payload.note != null) p.note = payload.note
    if (payload.settle_with !== undefined) p.settle_with = payload.settle_with || null
  }
  if (payload.excluded !== undefined) p.excluded = !!payload.excluded
  if (Array.isArray(payload.destinations)) p.invest = localInvest(tx, payload.destinations)
  return p
}

function patchList(list, ids, payload) {
  const alvo = new Set(ids || [])
  let mudou = false
  const out = (list || []).map((tx) => {
    if (!alvo.has(tx.id)) return tx
    mudou = true
    return { ...tx, ...patchOf(payload, tx) }
  })
  return mudou ? out : list
}

export function useData() {
  const [dash, setDash] = useState(null)
  const [mode, setMode] = useState('month')        // 'month' | 'year'
  const [month, setMonth] = useState(null)
  const [year, setYear] = useState(null)
  const [mdataMonth, setMdataMonth] = useState(null)
  const [yearView, setYearView] = useState(null)
  const [queue, setQueue] = useState([])
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const [pendingSaves, setPendingSaves] = useState(0)

  const loadQueue = useCallback(async () => {
    try { setQueue((await getQueue()).items || []) } catch { /* noop */ }
  }, [])

  const loadDash = useCallback(async () => {
    const d = await getDashboard()
    setCategoryMeta(d.category_meta, d.subcategory_meta)
    setDash(d)
    const last = d.months[d.months.length - 1]?.month
    setMonth((c) => c || last)
    setYear((c) => c || (last ? last.slice(0, 4) : null))
    return d
  }, [])

  useEffect(() => {
    loadDash().catch((e) => setError(e.message))
    loadQueue()
  }, [loadDash, loadQueue])

  // mês selecionado
  useEffect(() => {
    if (mode !== 'month' || !month) return
    let alive = true
    getMonth(month).then((m) => alive && setMdataMonth(m))
      .catch((e) => alive && setError(e.message))
    return () => { alive = false }
  }, [mode, month])

  // ano selecionado: junta os meses do ano
  useEffect(() => {
    if (mode !== 'year' || !dash || !year) return
    let alive = true
    const ms = dash.months.filter((m) => m.month.startsWith(year))
    Promise.all(ms.map((m) => getMonth(m.month).catch(() => null)))
      .then((files) => {
        if (!alive) return
        const txns = files.filter(Boolean).flatMap((f) => f.transactions || [])
        const savings = files.filter(Boolean).slice(-1)[0]?.savings || null
        setYearView(aggregateYear(year, ms, txns, savings))
      })
      .catch((e) => alive && setError(e.message))
    return () => { alive = false }
  }, [mode, dash, year])

  const refresh = useCallback(async () => {
    setBusy(true)
    try {
      const d = await loadDash()
      if (d && mode === 'month' && month) setMdataMonth(await getMonth(month))
      if (d && mode === 'year' && year) {
        const ms = d.months.filter((m) => m.month.startsWith(year))
        const files = await Promise.all(
          ms.map((m) => getMonth(m.month).catch(() => null)))
        const txns = files.filter(Boolean).flatMap((f) => f.transactions || [])
        const savings = files.filter(Boolean).slice(-1)[0]?.savings || null
        setYearView(aggregateYear(year, ms, txns, savings))
      }
      await loadQueue()
      setError(null)
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }, [loadDash, loadQueue, mode, month, year])

  // a fila drena fora do render; o refresh corrente vive num ref para não
  // reconfigurar o outbox a cada mudança de mês/ano
  const refreshRef = useRef(refresh)
  refreshRef.current = refresh

  useEffect(() => subscribe(setPendingSaves), [])

  // O relatório roda adiado no servidor. Recarregar antes dele terminar leria o
  // dashboard velho e desfaria a mudança na tela, então esperamos o arquivo
  // anunciar que foi regerado.
  const aguardaRelatorio = useCallback(async (desde) => {
    for (let tentativa = 0; tentativa < 12; tentativa++) {
      await new Promise((pronto) => setTimeout(pronto, 700))
      try {
        const d = await getDashboard()
        if (Date.parse(d.generated_at) > desde) {
          await refreshRef.current?.()
          return
        }
      } catch { /* relatório sendo reescrito; tenta de novo */ }
    }
  }, [])

  useEffect(() => {
    configure({
      onError: (_payload, e) => setError('Erro ao salvar: ' + e.message),
      onIdle: () => aguardaRelatorio(Date.now()),
    })
    drain()   // retoma o que ficou pendente de uma aba fechada no meio
  }, [aguardaRelatorio])

  const saveEdit = useCallback(async (payload) => {
    // fila do Claude não mexe no ledger: espera a resposta (quem chama recarrega).
    // Regra entra na fila de saída; os outros lançamentos que casarem chegam no refresh.
    if (payload.mode === 'queue') {
      await postEdit(payload)
      return
    }
    setMdataMonth((m) => (m
      ? { ...m, transactions: patchList(m.transactions, payload.ids, payload) } : m))
    setYearView((y) => (y
      ? { ...y, transactions: patchList(y.transactions, payload.ids, payload) } : y))
    setDash((d) => (d ? { ...d, recent: patchList(d.recent, payload.ids, payload) } : d))
    enqueue(payload)
  }, [])

  const view = mode === 'year' ? yearView : mdataMonth
  const periodKey = mode === 'year' ? year : month
  const years = dash ? yearsOf(dash.months) : []

  return {
    dash, view, periodKey, mode, month, year, years, queue, error, busy,
    pendingSaves, saveEdit,
    setMode, setMonth, setYear, setError, refresh, loadQueue,
  }
}
