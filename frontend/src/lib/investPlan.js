// Motor de aporte no navegador. Existe para o slider responder no arrasto: o Python é a
// fonte da verdade e confere tudo de novo na hora de gravar, e o teste de paridade em
// investPlan.test.js roda os mesmos casos nos dois lados para eles não divergirem calados.

const MODES = ['spread', 'focus']

function share(amount, deficits, mode) {
  const keys = Object.keys(deficits)
  const total = keys.reduce((sum, key) => sum + deficits[key], 0)
  const out = {}
  if (amount <= 0 || total <= 0) {
    keys.forEach((key) => { out[key] = 0 })
    return out
  }
  if (mode === 'focus') {
    const biggest = keys.reduce((a, b) => (deficits[b] > deficits[a] ? b : a))
    keys.forEach((key) => { out[key] = key === biggest ? amount : 0 })
    return out
  }
  keys.forEach((key) => { out[key] = (amount * deficits[key]) / total })
  return out
}

function roundToLot(amount, price, lot) {
  if (!price || price <= 0) return [0, amount]
  const step = lot && lot > 0 ? lot : 1
  const lots = Math.floor(amount / (price * step) + 1e-9)
  const quantity = Math.max(lots, 0) * step
  return [quantity, quantity * price]
}

function reallocate(orders, leftover) {
  let left = leftover
  if (left <= 0) return left
  for (;;) {
    const able = orders.filter((o) => o.price && o.missing > 0
      && o.price * (o.lot_size || 1) <= left + 1e-9)
    if (!able.length) return left
    const order = able.reduce((a, b) => (b.missing > a.missing ? b : a))
    const lot = order.lot_size || 1
    const step = order.price * lot
    order.quantity += lot
    order.amount += step
    order.missing -= step
    left -= step
  }
}

export function buildPlan({ allocation, assets, positions, contribution,
  mode = 'spread', targets = null }) {
  const chosen = MODES.includes(mode) ? mode : 'spread'
  const money = Math.max(Number(contribution) || 0, 0)
  const spread = {}
  allocation.forEach((item) => { spread[item.node] = item })
  const eligible = allocation.filter((i) => i.in_totals)
    .reduce((sum, i) => sum + i.value, 0)
  const base = eligible + money

  const weights = {}
  allocation.filter((i) => i.in_totals)
    .forEach((i) => { weights[i.node] = i.target_pct })

  const deficits = {}
  const nodeTargets = {}
  Object.entries(weights).forEach(([node, weight]) => {
    const target = base * weight
    nodeTargets[node] = target
    deficits[node] = Math.max(0, target - (spread[node]?.value || 0))
  })
  const anyGap = Object.values(deficits).some((value) => value > 0)
  const perNode = share(money, anyGap ? deficits : { ...weights }, chosen)

  const assetTarget = (asset) => (targets?.[asset.ticker] ?? asset.target_pct)
  const orders = []
  Object.entries(perNode).forEach(([node, amount]) => {
    const inNode = assets.filter((a) => a.node === node && a.active !== false)
    if (!inNode.length || amount <= 0) return
    const nodeValue = (spread[node]?.value || 0) + amount
    const gaps = {}
    inNode.forEach((asset) => {
      const held = positions[asset.ticker]?.value || 0
      gaps[asset.ticker] = Math.max(0, nodeValue * assetTarget(asset) - held)
    })
    const anyAssetGap = Object.values(gaps).some((value) => value > 0)
    const fallback = {}
    inNode.forEach((asset) => { fallback[asset.ticker] = assetTarget(asset) })
    Object.entries(share(amount, anyAssetGap ? gaps : fallback, chosen))
      .forEach(([ticker, piece]) => {
        if (piece <= 0) return
        const asset = inNode.find((a) => a.ticker === ticker)
        const position = positions[ticker] || {}
        const price = asset.valuation === 'quote' ? (position.price ?? null) : null
        const [quantity, cost] = roundToLot(piece, price, asset.lot_size)
        orders.push({
          ticker, name: asset.name || ticker, node, account: asset.account || null,
          price, lot_size: asset.lot_size || 1, quantity, amount: cost,
          wanted: piece, missing: (gaps[ticker] ?? piece) - cost,
        })
      })
  })

  let allocated = orders.reduce((sum, o) => sum + o.amount, 0)
  reallocate(orders, money - allocated)
  allocated = orders.reduce((sum, o) => sum + o.amount, 0)

  const after = {}
  allocation.forEach((item) => {
    after[item.node] = item.value
      + orders.filter((o) => o.node === item.node).reduce((s, o) => s + o.amount, 0)
  })
  const baseAfter = allocation.filter((i) => i.in_totals)
    .reduce((sum, i) => sum + after[i.node], 0)

  const nodes = [...allocation].sort((a, b) => b.value - a.value).map((item) => {
    const added = orders.filter((o) => o.node === item.node)
      .reduce((sum, o) => sum + o.amount, 0)
    const realAfter = baseAfter && item.in_totals ? after[item.node] / baseAfter : 0
    return {
      node: item.node, name: item.name, value: item.value,
      target_value: nodeTargets[item.node] || 0,
      deficit: item.in_totals ? (deficits[item.node] || 0) : 0,
      amount: added, in_totals: item.in_totals,
      real_pct: item.real_pct, target_pct: item.target_pct,
      drift_before: item.drift,
      drift_after: item.in_totals ? realAfter - item.target_pct : 0,
    }
  })

  const blocked = [...new Set(orders.filter((o) => o.missing > 0 && o.price)
    .map((o) => o.node))].sort()
  return {
    contribution: money, mode: chosen, eligible_value: eligible, allocated,
    leftover: Math.max(money - allocated, 0), blocked_nodes: blocked, nodes,
    orders: orders.filter((o) => o.amount > 0)
      .sort((a, b) => b.amount - a.amount)
      .map(({ missing, ...order }) => order),
  }
}
