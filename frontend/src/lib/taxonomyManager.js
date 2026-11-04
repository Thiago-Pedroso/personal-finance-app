const name = (value) => typeof value === 'string' && value.trim() && !value.includes(',')
  ? value.trim() : null
const same = (a, b) => JSON.stringify(Object.keys(a || {}).sort().map((key) => [key, a[key]]))
  === JSON.stringify(Object.keys(b || {}).sort().map((key) => [key, b[key]]))

export function buildOperation(kind, fields) {
  const category = name(fields.category)
  const subcategory = name(fields.subcategory)
  const newCategory = name(fields.newCategory)
  const newSubcategory = name(fields.newSubcategory)
  if (kind === 'create-category' && category && ['fluxo', 'poupança', 'movimento'].includes(fields.treatment))
    return { kind, category, treatment: fields.treatment }
  if (kind === 'create-subcategory' && category && subcategory) return { kind, category, subcategory }
  if (kind === 'rename-category' && category && newCategory) return { kind, category, newCategory }
  if (kind === 'rename-subcategory' && category && subcategory && newSubcategory)
    return { kind, category, subcategory, newSubcategory }
  if (kind === 'delete-category' && category) return { kind, category }
  if (kind === 'delete-subcategory' && category && subcategory) return { kind, category, subcategory }
  return null
}

export function taxonomyRows(taxonomy = {}, treatments = {}) {
  return Object.keys(taxonomy).sort((a, b) => a.localeCompare(b, 'pt-BR')).map((category) => ({
    category, treatment: treatments[category] || 'fluxo',
    subcategories: [...(taxonomy[category] || [])].sort((a, b) => a.localeCompare(b, 'pt-BR')),
  }))
}

export function impactText(impact = {}) {
  return `${impact.normalTransactions || 0} lançamentos normais, ${impact.rules || 0} regra${impact.rules === 1 ? '' : 's'}, ${impact.splitParts || 0} partes de split em ${impact.splitTransactions || 0} transação${impact.splitTransactions === 1 ? '' : 'ões'}.`
}

export function canConfirm(operation, preview, acknowledged) {
  return !!(acknowledged && preview?.fingerprint && same(operation, preview.operation))
}

export const isDestructive = (operation) => operation?.kind?.startsWith('delete')
