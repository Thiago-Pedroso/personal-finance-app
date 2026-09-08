import { createContext, useCallback, useContext, useEffect, useState } from 'react'

const PrivacyContext = createContext(null)
const STORAGE_KEY = 'finance-control.values-hidden'

function readInitialState() {
  if (typeof window === 'undefined') return false
  try {
    return window.localStorage.getItem(STORAGE_KEY) === 'true'
  } catch {
    return false
  }
}

export function PrivacyProvider({ children }) {
  const [valuesHidden, setValuesHidden] = useState(readInitialState)
  const toggleValues = useCallback(() => setValuesHidden((hidden) => !hidden), [])

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, String(valuesHidden))
    } catch {
      return
    }
  }, [valuesHidden])

  return (
    <PrivacyContext.Provider value={{ valuesHidden, toggleValues }}>
      {children}
    </PrivacyContext.Provider>
  )
}

export function usePrivacy() {
  const context = useContext(PrivacyContext)
  if (!context) throw new Error('usePrivacy must be used within PrivacyProvider')
  return context
}
