export function buildInvestmentComposition({ allocation = [], policy = [],
  scope = 'strategy' }) {
  const policyByNode = Object.fromEntries(policy.map((node) => [node.node, node]))
  const includeCompletePortfolio = scope === 'portfolio'
  const slices = allocation
    .filter((item) => item.value > 0 && (item.in_totals
      || (includeCompletePortfolio
        && policyByNode[item.node]?.role === 'strategy')))
    .sort((first, second) => second.value - first.value)
  const total = slices.reduce((sum, item) => sum + item.value, 0)

  return {
    total,
    slices: slices.map((item) => ({
      node: item.node,
      name: item.name,
      value: item.value,
      share: total ? item.value / total : 0,
      color: policyByNode[item.node]?.color || null,
      outsideStrategy: !item.in_totals,
    })),
  }
}
