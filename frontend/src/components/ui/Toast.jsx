import { createContext, useCallback, useContext, useState } from 'react'
import { CheckCircle2, XCircle, Info } from 'lucide-react'

const Ctx = createContext(() => {})
export const useToast = () => useContext(Ctx)

const ICON = {
  success: <CheckCircle2 className="size-4 text-green" />,
  error: <XCircle className="size-4 text-red" />,
  info: <Info className="size-4 text-blue" />,
}

export function ToastProvider({ children }) {
  const [items, setItems] = useState([])
  const push = useCallback((msg, type = 'success', ttl = 4200) => {
    const id = Math.random().toString(36).slice(2)
    setItems((x) => [...x, { id, msg, type }])
    setTimeout(() => setItems((x) => x.filter((i) => i.id !== id)), ttl)
  }, [])
  return (
    <Ctx.Provider value={push}>
      {children}
      <div className="fixed bottom-5 right-5 z-[100] flex flex-col gap-2">
        {items.map((i) => (
          <div key={i.id} className="fade-in flex items-start gap-2.5 rounded-xl
            border border-border bg-surface2 px-4 py-3 text-[13px] shadow-xl
            max-w-sm">
            {ICON[i.type]}
            <span className="whitespace-pre-wrap">{i.msg}</span>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  )
}
