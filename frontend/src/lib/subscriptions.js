export function subscriptionRows(txns) {
  return txns.flatMap((transaction) => {
    if (transaction.excluded) return []
    if (transaction.splits?.length) {
      return transaction.splits.flatMap((split, index) =>
        split.subcategory === 'Assinaturas' ? [{
          id: `${transaction.id}:${index}`, transaction, amount: split.amount,
          category: split.category || null, subcategory: 'Assinaturas', isSplit: true,
        }] : [])
    }
    return transaction.subcategory === 'Assinaturas' ? [{
      // Split rows above intentionally use each part, matching report._add().
      id: transaction.id, transaction, amount: transaction.signed_amount,
      category: transaction.category || null, subcategory: 'Assinaturas', isSplit: false,
    }] : []
  })
}
