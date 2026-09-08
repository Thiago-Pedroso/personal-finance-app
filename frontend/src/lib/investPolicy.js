export function groupPolicyNodes(policy) {
  const nodesById = Object.fromEntries(policy.map((node) => [node.node, node]))
  const groupsByParent = new Map()

  policy.filter((node) => node.counts).forEach((node) => {
    const parent = node.parent || ''
    if (!groupsByParent.has(parent)) groupsByParent.set(parent, [])
    groupsByParent.get(parent).push(node)
  })

  return [...groupsByParent.entries()]
    .map(([parent, nodes]) => ({
      parent,
      name: nodesById[parent]?.name || 'Carteira',
      nodes,
    }))
    .filter((group) => group.nodes.length > 1)
}

export function updateGroupTargets(targets, nodes, changedNode, nextValue) {
  const value = Math.min(Math.max(Number(nextValue) || 0, 0), 1)
  const siblings = nodes.filter((node) => node.node !== changedNode)
  const result = { ...targets, [changedNode]: value }
  if (!siblings.length) return result

  const remaining = 1 - value
  const siblingsTotal = siblings.reduce(
    (sum, node) => sum + Math.max(targets[node.node] || 0, 0), 0)

  siblings.forEach((node) => {
    const share = siblingsTotal > 0
      ? Math.max(targets[node.node] || 0, 0) / siblingsTotal
      : 1 / siblings.length
    result[node.node] = remaining * share
  })

  return result
}

const ROLE_PRIORITY = {
  reserved: 0,
  free: 1,
  to_invest: 2,
}

export function orderPortfolioNodes(allocation, policy) {
  const policyByNode = Object.fromEntries(policy.map((node) => [node.node, node]))
  const policyOrder = Object.fromEntries(
    policy.map((node, index) => [node.node, index]))
  const pathCache = new Map()

  const pathOf = (nodeId) => {
    if (pathCache.has(nodeId)) return pathCache.get(nodeId)
    const path = []
    const visited = new Set()
    let current = policyByNode[nodeId]
    while (current && !visited.has(current.node)) {
      visited.add(current.node)
      path.unshift(current)
      current = current.parent ? policyByNode[current.parent] : null
    }
    pathCache.set(nodeId, path)
    return path
  }

  const rankOf = (item) => {
    const role = policyByNode[item.node]?.role || 'strategy'
    if (Object.hasOwn(ROLE_PRIORITY, role)) return ROLE_PRIORITY[role]
    return item.in_totals ? 3 : 4
  }

  return [...allocation].sort((first, second) => {
    const rankDifference = rankOf(first) - rankOf(second)
    if (rankDifference) return rankDifference

    if (rankOf(first) === 3) {
      const firstPath = pathOf(first.node)
      const secondPath = pathOf(second.node)
      const depthDifference = firstPath.length - secondPath.length
      if (depthDifference) return depthDifference
      for (let index = 0; index < firstPath.length; index += 1) {
        const targetDifference = (secondPath[index].target_pct || 0)
          - (firstPath[index].target_pct || 0)
        if (Math.abs(targetDifference) > 1e-9) return targetDifference
      }
    }

    return (policyOrder[first.node] ?? Number.MAX_SAFE_INTEGER)
      - (policyOrder[second.node] ?? Number.MAX_SAFE_INTEGER)
  })
}
