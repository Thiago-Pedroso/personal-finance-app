import { useEffect, useRef, useState } from 'react'
import { ChevronDown, Check } from 'lucide-react'

export function MultiSelect({ label, options, value, onChange }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  useEffect(() => {
    const h = (e) => ref.current && !ref.current.contains(e.target) && setOpen(false)
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])
  const toggle = (o) =>
    onChange(value.includes(o) ? value.filter((v) => v !== o) : [...value, o])

  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 rounded-xl border border-border
          bg-surface2 px-3 py-2 text-[13px] hover:border-faint">
        <span className="text-muted">{label}</span>
        {value.length > 0 && (
          <span className="rounded-full bg-green/20 px-1.5 text-[11px]
            font-semibold text-green">{value.length}</span>
        )}
        <ChevronDown className="size-3.5 text-faint" />
      </button>
      {open && (
        <div className="absolute z-30 mt-1.5 max-h-72 w-60 overflow-y-auto
          rounded-xl border border-border bg-surface2 p-1.5 shadow-2xl fade-in">
          {value.length > 0 && (
            <button onClick={() => onChange([])}
              className="mb-1 w-full rounded-lg px-2.5 py-1.5 text-left
                text-[12px] text-muted hover:bg-white/5">
              Limpar seleção
            </button>
          )}
          {options.map((o) => (
            <button key={o} onClick={() => toggle(o)}
              className="flex w-full items-center justify-between rounded-lg
                px-2.5 py-1.5 text-left text-[13px] hover:bg-white/5">
              <span className="truncate">{o}</span>
              {value.includes(o) && <Check className="size-3.5 text-green" />}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export function inputCls(extra = '') {
  return `rounded-xl border border-border bg-surface2 px-3 py-2 text-[13px]
    placeholder:text-faint focus:border-faint ${extra}`
}
