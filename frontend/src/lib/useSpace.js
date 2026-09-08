import { useEffect, useState } from 'react'

// Espaço e aba vivem no hash (#/investimentos/carteira), então o F5 não perde o lugar e
// dá para mandar link de uma tela específica.
export const SPACES = {
  financas: ['overview', 'txns', 'cats', 'tags', 'plan', 'tools', 'poup', 'movs',
             'review'],
  investimentos: ['visao', 'carteira', 'aporte', 'caixinhas', 'operacoes',
                  'simulador'],
}

function parse() {
  const [, space, tab] = (window.location.hash || '').split('/')
  const valid = SPACES[space] ? space : 'financas'
  return { space: valid, tab: SPACES[valid].includes(tab) ? tab : SPACES[valid][0] }
}

export function useSpace() {
  const [state, setState] = useState(parse)

  useEffect(() => {
    const onHash = () => setState(parse())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  const go = (space, tab) => {
    const next = { space, tab: tab || SPACES[space][0] }
    window.location.hash = `/${next.space}/${next.tab}`
    setState(next)
  }
  return { ...state, go, setTab: (tab) => go(state.space, tab) }
}
