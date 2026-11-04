import { useEffect, useState } from 'react'
import { SPACES, hashFor, parseHash } from './nav.js'

export { SPACES }

// Espaço e aba vivem no hash (#/investimentos/carteira), então o F5 não perde o lugar e
// dá para mandar link de uma tela específica. As abas válidas vêm do mapa do menu.
const parse = () => parseHash(window.location.hash)

export function useSpace() {
  const [state, setState] = useState(parse)

  useEffect(() => {
    const onHash = () => setState(parse())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  const go = (space, tab) => {
    const next = { space, tab: tab || SPACES[space][0] }
    window.location.hash = hashFor(next.space, next.tab)
    setState(next)
  }
  return { ...state, go, setTab: (tab) => go(state.space, tab) }
}
