export function buildBucketReconciliations({ accounts = [], positions = [],
  reports = {} }) {
  return accounts
    .filter((account) => account.kind === 'bucket' && reports[account.id])
    .map((account) => {
      const total = Number(reports[account.id].total) || 0
      const registered = positions
        .filter((position) => position.account === account.id
          && position.valuation === 'balance')
        .reduce((sum, position) => sum + (Number(position.value) || 0), 0)
      return {
        accountId: account.id,
        accountName: account.name,
        total,
        registered,
        difference: total - registered,
      }
    })
}
