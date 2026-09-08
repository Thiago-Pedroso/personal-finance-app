import { Fragment } from 'react'
import { usePrivacy } from '../../lib/usePrivacy.jsx'

const MASK = 'R$ •••••'
const MONEY_PATTERN = /[+−-]?R\$\s*[\d.,]+/g
const PRIVATE_INPUT_PROPS = new Set([
  'value', 'defaultValue', 'onChange', 'placeholder',
])

export function SensitiveAmount({ children, className = '' }) {
  const { valuesHidden } = usePrivacy()
  return (
    <span className={`inline-block min-w-[8ch] whitespace-nowrap ${className}`}>
      {valuesHidden ? (
        <>
          <span aria-hidden="true">{MASK}</span>
          <span className="sr-only">Valor oculto</span>
        </>
      ) : children}
    </span>
  )
}

export function SensitiveFinancialText({ children }) {
  const { valuesHidden } = usePrivacy()
  if (!valuesHidden || typeof children !== 'string') return children
  return children.split(MONEY_PATTERN).map((segment, index, segments) => (
    <Fragment key={`${index}-${segment}`}>
      {segment}
      {index < segments.length - 1 && <SensitiveAmount>{MASK}</SensitiveAmount>}
    </Fragment>
  ))
}

export function SensitiveMoneyInput({ type = 'number', ...props }) {
  const { valuesHidden } = usePrivacy()
  if (!valuesHidden) return <input type={type} {...props} />
  const maskedProps = Object.fromEntries(Object.entries(props)
    .filter(([key]) => !PRIVATE_INPUT_PROPS.has(key)))
  return (
    <input {...maskedProps} type="text" value="••••••" disabled
      aria-label="Valor monetário oculto"
      title="Mostre os valores para editar" />
  )
}
