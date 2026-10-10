import { useEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { monthLong, monthShort } from '../lib/format.js'

const isTyping = (target) =>
  target?.closest?.('input, textarea, select, [contenteditable="true"], [role="dialog"]')

// Mês/Ano + setas + grade de meses; as setas do teclado também trocam o período
export function PeriodNav({ mode, setMode, months, month, setMonth, years, year, setYear }) {
  const [open, setOpen] = useState(false)
  const boxRef = useRef(null)
  const options = mode === 'month' ? months : years
  const current = mode === 'month' ? month : year
  const index = options.indexOf(current)
  const pick = (value) => (mode === 'month' ? setMonth(value) : setYear(value))
  const step = (delta) => {
    const next = options[index + delta]
    if (next) pick(next)
  }

  useEffect(() => {
    const onKey = (event) => {
      if (event.altKey || event.ctrlKey || event.metaKey || isTyping(event.target)) return
      if (event.key === 'ArrowLeft') step(-1)
      if (event.key === 'ArrowRight') step(1)
      if (event.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  useEffect(() => {
    if (!open) return undefined
    const onClick = (event) => {
      if (!boxRef.current?.contains(event.target)) setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [open])

  const available = new Set(months)
  const gridYears = [...new Set(months.map((m) => m.slice(0, 4)))].sort().reverse()
  const arrow = 'grid size-9 place-items-center rounded-lg text-secondary transition '
    + 'hover:bg-surface2 hover:text-strong disabled:opacity-30 disabled:pointer-events-none'

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex gap-1 rounded-xl border border-border bg-surface2/70 p-1
        text-[13px]">
        {[['month', 'Mês'], ['year', 'Ano']].map(([key, label]) => (
          <button key={key} onClick={() => setMode(key)} aria-pressed={mode === key}
            className={`rounded-lg px-3.5 py-1.5 transition ${mode === key
              ? 'bg-brand shadow-[0_1px_8px_#5b9dff55]' : 'hover:bg-surface2'}`}>
            <span className={`text-[13px] font-semibold ${mode === key
              ? 'text-white' : 'text-secondary'}`}>{label}</span>
          </button>
        ))}
      </div>
      <div ref={boxRef} className="relative flex items-center gap-1 rounded-xl border
        border-border bg-surface2/70 p-1">
        <button className={arrow} onClick={() => step(-1)} disabled={index <= 0}
          aria-label={mode === 'month' ? 'Mês anterior' : 'Ano anterior'}>
          <ChevronLeft className="size-5" />
        </button>
        <button onClick={() => setOpen((value) => !value)} aria-expanded={open}
          aria-haspopup="dialog"
          className="min-w-[184px] rounded-lg px-3 py-1.5 text-center transition
            hover:bg-surface2">
          <span className="text-[17px] font-bold tracking-[-0.01em] text-strong">
            {monthLong(current)}</span>
        </button>
        <button className={arrow} onClick={() => step(1)}
          disabled={index < 0 || index >= options.length - 1}
          aria-label={mode === 'month' ? 'Próximo mês' : 'Próximo ano'}>
          <ChevronRight className="size-5" />
        </button>

        {open && (
          <div className="absolute right-0 top-full z-30 mt-2 w-[296px] rounded-2xl
            border border-border bg-surface p-3 shadow-2xl">
            {mode === 'year' ? (
              <div className="grid grid-cols-3 gap-1.5">
                {[...years].reverse().map((value) => (
                  <button key={value} onClick={() => { setYear(value); setOpen(false) }}
                    className={`rounded-lg py-2 transition ${
                      value === year ? 'bg-brand' : 'hover:bg-surface2'}`}>
                    <span className={`text-[14px] font-semibold ${
                      value === year ? 'text-white' : 'text-secondary'}`}>{value}</span>
                  </button>
                ))}
              </div>
            ) : gridYears.map((value) => (
              <div key={value} className="mb-2 last:mb-0">
                <p className="mb-1.5 px-1 text-[13px] font-bold text-strong">{value}</p>
                <div className="grid grid-cols-4 gap-1.5">
                  {Array.from({ length: 12 }, (_, i) => {
                    const key = `${value}-${String(i + 1).padStart(2, '0')}`
                    const enabled = available.has(key)
                    return (
                      <button key={key} disabled={!enabled}
                        onClick={() => { setMonth(key); setOpen(false) }}
                        className={`rounded-lg py-1.5 transition disabled:cursor-default ${
                          key === month ? 'bg-brand' : enabled ? 'hover:bg-surface2' : ''}`}>
                        <span className={`text-[13.5px] font-semibold capitalize ${
                          key === month ? 'text-white'
                            : enabled ? 'text-secondary' : 'text-faint/40'}`}>
                          {monthShort(i)}</span>
                      </button>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
