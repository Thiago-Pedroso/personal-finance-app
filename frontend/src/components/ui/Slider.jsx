// Slider nativo estilizado — trilho fino, "preenchido" no azul da marca.
export function Slider({ value, min, max, step = 1, onChange, className = '' }) {
  const pct = max > min ? ((value - min) / (max - min)) * 100 : 0
  return (
    <input
      type="range" min={min} max={max} step={step} value={value}
      onChange={(e) => onChange(+e.target.value)}
      className={`h-1.5 w-full cursor-pointer appearance-none rounded-full
        [&::-webkit-slider-thumb]:size-4 [&::-webkit-slider-thumb]:appearance-none
        [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-brand
        [&::-webkit-slider-thumb]:shadow-[0_1px_4px_#5b9dff80]
        [&::-webkit-slider-thumb]:cursor-pointer
        [&::-moz-range-thumb]:size-4 [&::-moz-range-thumb]:border-0
        [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-brand ${className}`}
      style={{ background: `linear-gradient(to right,
        var(--color-brand) ${pct}%, var(--color-surface2) ${pct}%)` }}
    />
  )
}
