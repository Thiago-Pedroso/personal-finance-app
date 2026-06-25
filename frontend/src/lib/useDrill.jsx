import { createContext, useContext, useState, useCallback } from 'react'

const Ctx = createContext(null)
export const useDrill = () => useContext(Ctx)

// filter: { cats?[], sub?, flow?'in'|'out', rev?bool, q? }
export function DrillProvider({ children }) {
  const [state, setState] = useState({ open: false, title: '', filter: {} })
  const drill = useCallback((title, filter) =>
    setState({ open: true, title, filter: filter || {} }), [])
  const close = useCallback(() =>
    setState((s) => ({ ...s, open: false })), [])
  return (
    <Ctx.Provider value={{ ...state, drill, close }}>
      {children}
    </Ctx.Provider>
  )
}
