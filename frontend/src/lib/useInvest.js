import { useCallback, useEffect, useState } from 'react'
import { getInvest, postInvest, refreshInvest, syncInvest } from './api.js'

// O relatório é gerado pelo Python; aqui só lemos e pedimos recálculo. A carteira nunca
// é alterada na tela sem passar pelo mesmo caminho de gravação do modo conversa.
export function useInvest(enabled) {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const [loaded, setLoaded] = useState(false)

  const load = useCallback(async () => {
    try {
      setData(await getInvest())
      setError(null)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoaded(true)
    }
  }, [])

  useEffect(() => { if (enabled && !loaded) load() }, [enabled, loaded, load])

  const apply = useCallback(async (payload) => {
    setBusy(true)
    try {
      await postInvest(payload)
      await load()
    } finally {
      setBusy(false)
    }
  }, [load])

  const refresh = useCallback(async () => {
    setBusy(true)
    try {
      await refreshInvest()
      await load()
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }, [load])

  const sync = useCallback(async (opts) => {
    setBusy(true)
    try {
      await syncInvest(opts)
      await load()
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }, [load])

  return { data, error, busy, loaded, load, apply, refresh, sync }
}
