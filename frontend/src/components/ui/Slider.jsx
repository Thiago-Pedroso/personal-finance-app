export function Slider({ value, min, max, step = 1, onChange, className = '',
  disabled = false, size = 'default' }) {
  const pct = max > min ? ((value - min) / (max - min)) * 100 : 0
  const dimensions = size === 'large'
    ? `h-3 [&::-webkit-slider-thumb]:size-6
      [&::-webkit-slider-thumb]:border-4 [&::-webkit-slider-thumb]:border-[#dbeaff]
      [&::-moz-range-thumb]:size-5 [&::-moz-range-thumb]:border-4
      [&::-moz-range-thumb]:border-[#dbeaff]`
    : `h-1.5 [&::-webkit-slider-thumb]:size-4
      [&::-moz-range-thumb]:size-4 [&::-moz-range-thumb]:border-0`
  return (
    <input
      type="range" min={min} max={max} step={step} value={value}
      disabled={disabled}
      onChange={(e) => onChange(+e.target.value)}
      className={`w-full cursor-pointer appearance-none rounded-full
        disabled:cursor-not-allowed disabled:opacity-45
        [&::-webkit-slider-thumb]:appearance-none
        [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-brand
        [&::-webkit-slider-thumb]:shadow-[0_1px_4px_#5b9dff80]
        [&::-webkit-slider-thumb]:cursor-pointer
        [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-brand
        ${className} ${dimensions}`}
      style={{ background: `linear-gradient(to right,
        var(--color-brand) ${pct}%, var(--color-surface2) ${pct}%)` }}
    />
  )
}
