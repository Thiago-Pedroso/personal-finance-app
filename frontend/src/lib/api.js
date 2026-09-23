async function getJSON(url) {
  const r = await fetch(`${url}?t=${Date.now()}`, { cache: 'no-store' })
  if (!r.ok) {
    let m = `${url} (${r.status})`
    try { m = (await r.json()).error || m } catch { /* noop */ }
    throw new Error(m)
  }
  return r.json()
}
async function postJSON(url, body) {
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = await r.json().catch(() => ({}))
  if (!r.ok || data.ok === false) {
    throw new Error(data.error || data.stderr || `Falha (${r.status})`)
  }
  return data
}

export const getDashboard = () => getJSON('/data/dashboard.json')
export const getMonth = (m) => getJSON(`/data/${m}.json`)
export const getQueue = () => getJSON('/api/queue')
export const getRules = () => getJSON('/data/rules.json')
export const removeQueue = (index) => postJSON('/api/queue/remove', { index })
// patch: { note?, suggestion?: {category, subcategory} | null }
export const updateQueue = (index, patch) =>
  postJSON('/api/queue/update', { index, ...patch })

// payload: { mode:'value'|'rule'|'queue', ids[], category, subcategory,
//            rule?{field,match,value,type}, note?, samples? }
export const postEdit = (payload) => postJSON('/api/edit', payload)

// budgets = { income_plan, spending:{recurring,months}, savings_goals }
export const postBudget = (budgets) => postJSON('/api/budget', budgets)

// ---- espaço Investimentos ----------------------------------------------------
export const getInvest = () => getJSON('/data/invest.json')
export const getInvestPending = () => getJSON('/api/invest/pending')
// payload = { trades?, assets?, accounts?, policy?, targets?, locked?, balances?,
//             contribution?, contribution_mode?, allocation_sim? }
export const postInvest = (payload) => postJSON('/api/invest/apply', payload)
export const refreshInvest = () => postJSON('/api/invest/refresh', {})
export const syncInvest = (opts = {}) => postJSON('/api/invest/sync', opts)
