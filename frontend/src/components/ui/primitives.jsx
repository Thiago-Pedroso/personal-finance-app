export function Card({ className = '', children, ...p }) {
  return (
    <div {...p} className={`rounded-2xl border border-border bg-surface/80
      backdrop-blur shadow-[0_1px_0_#ffffff0a_inset,0_10px_30px_#00000040]
      ${className}`}>
      {children}
    </div>
  )
}

export function CardHead({ title, sub, right }) {
  return (
    <div className="flex items-start justify-between gap-3 px-5 pt-4 pb-3">
      <div>
        <h3 className="text-[12px] font-semibold uppercase tracking-wider
          text-muted">{title}</h3>
        {sub && <p className="mt-1 text-[12px] text-faint">{sub}</p>}
      </div>
      {right}
    </div>
  )
}

const VARIANTS = {
  primary: 'bg-green text-[#04130c] hover:brightness-110 font-semibold',
  default: 'bg-surface2 border border-border hover:border-faint',
  ghost: 'bg-transparent hover:bg-surface2',
  danger: 'bg-red/15 text-red border border-red/40 hover:bg-red/25',
}
export function Button({ variant = 'default', className = '', children, ...p }) {
  return (
    <button {...p} className={`inline-flex items-center gap-2 rounded-xl
      px-3.5 py-2 text-[13px] transition disabled:opacity-50
      disabled:pointer-events-none ${VARIANTS[variant]} ${className}`}>
      {children}
    </button>
  )
}

export function Badge({ tone = 'muted', children }) {
  const t = {
    muted: 'bg-white/5 text-muted border-border',
    green: 'bg-green/15 text-green border-green/40',
    red: 'bg-red/15 text-red border-red/40',
    amber: 'bg-amber/15 text-amber border-amber/40',
    blue: 'bg-blue/15 text-blue border-blue/40',
    violet: 'bg-violet/15 text-violet border-violet/40',
  }[tone]
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5
      text-[11px] font-semibold ${t}`}>{children}</span>
  )
}

export function Skeleton({ className = '' }) {
  return <div className={`rounded-lg bg-surface2 animate-[pulse_1.4s_ease-in-out_infinite]
    ${className}`} />
}

export function Spinner({ className = '' }) {
  return <span className={`inline-block size-4 rounded-full border-2
    border-border border-t-green animate-[spin_.8s_linear_infinite]
    ${className}`} />
}

export function Empty({ children }) {
  return <div className="py-12 text-center text-[13px] text-faint">{children}</div>
}
