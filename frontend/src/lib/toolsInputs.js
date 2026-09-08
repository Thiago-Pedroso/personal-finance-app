// Deriva do dashboard.json os números reais que pré-preenchem as ferramentas.
// Nada aqui bate na rede — só lê o que report.py já gerou.

const avg = (arr, key) =>
  arr.length ? arr.reduce((a, m) => a + (m[key] || 0), 0) / arr.length : 0

// categorias "de sobrevivência" — base da reserva de emergência. Vêm da coluna
// Essential da aba Taxonomy; sem nenhuma marcada, cai no gasto total do mês.
const essentialOf = (m, cats) =>
  cats.length
    ? cats.reduce((a, c) => a + ((m.by_category?.[c]?.expense) || 0), 0)
    : (m.expense || 0)

export function deriveToolsInputs(dash, { window = 6 } = {}) {
  const months = (dash?.months || []).filter((m) => m && typeof m.net === 'number')
  const lastN = months.slice(-window)

  const sobraMedia = avg(lastN, 'net')        // renda − gastos, média dos últimos meses
  const gastosMedios = avg(lastN, 'expense')
  const essentialCats = dash?.essential_cats || []
  const gastosEssenciais = lastN.length
    ? lastN.reduce((a, m) => a + essentialOf(m, essentialCats), 0) / lastN.length : 0
  const rendaMedia = avg(lastN, 'income')

  // patrimônio atual = "Tenho hoje" das metas (Reserva) — decisão de Fase 1, editável no card
  const goals = dash?.budgets?.savings_goals || []
  const patrimonio = goals.reduce((a, g) => a + (g.current || 0), 0)

  return {
    sobraMedia,
    gastosMedios,
    gastosEssenciais,
    rendaMedia,
    patrimonio,
    aporteSugerido: Math.max(0, Math.round(sobraMedia / 10) * 10),
    monthsCount: months.length,
    window: lastN.length,
  }
}
