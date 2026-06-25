import { useCallback, useEffect, useState } from 'react'
import { getDashboard, getMonth, getQueue } from './api.js'
import { aggregateYear, yearsOf } from './aggregate.js'

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

  const loadQueue = useCallback(async () => {
    try { setQueue((await getQueue()).items || []) } catch { /* noop */ }
  }, [])

  const loadDash = useCallback(async () => {
    const d = await getDashboard()
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

  const view = mode === 'year' ? yearView : mdataMonth
  const periodKey = mode === 'year' ? year : month
  const years = dash ? yearsOf(dash.months) : []

  return {
    dash, view, periodKey, mode, month, year, years, queue, error, busy,
    setMode, setMonth, setYear, setError, refresh, loadQueue,
  }
}
