// Fila de saída das edições: a tela muda na hora e a gravação acontece atrás.
// Persiste em localStorage para uma aba fechada no meio não perder o que faltava.
import { postEdit } from './api.js'

const KEY = 'finance.outbox.v1'
let queue = read()
let draining = false
let handlers = {}
const listeners = new Set()

function read() {
  try { return JSON.parse(localStorage.getItem(KEY)) || [] } catch { return [] }
}

function persist() {
  try { localStorage.setItem(KEY, JSON.stringify(queue)) } catch { /* cota/privado */ }
  listeners.forEach((fn) => fn(queue.length))
}

// onError(payload, erro) por item; onIdle() quando a fila esvazia.
export function configure(h) { handlers = h || {} }

export function subscribe(fn) {
  listeners.add(fn)
  fn(queue.length)
  return () => listeners.delete(fn)
}

export function enqueue(payload) {
  queue = [...queue, { at: Date.now(), payload }]
  persist()
  drain()
}

export async function drain() {
  if (draining || !queue.length) return
  draining = true
  let falhou = false
  while (queue.length) {
    const item = queue[0]
    try {
      await postEdit(item.payload)
    } catch (e) {
      falhou = true
      handlers.onError?.(item.payload, e)
    }
    queue = queue.slice(1)
    persist()
  }
  draining = false
  handlers.onIdle?.(falhou)
}

if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', (e) => {
    if (!queue.length) return
    e.preventDefault()
    e.returnValue = ''
  })
}
