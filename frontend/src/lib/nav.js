// Mapa da navegação: espaços → grupos → telas. É a fonte única do menu lateral, da
// gaveta do celular, da barra inferior e das abas válidas no hash (#/espaco/aba).
// Os ícones vão por nome (lucide-react) para este arquivo continuar testável no Node.
// `periodless: true` marca a tela que mostra o histórico inteiro: o seletor de mês some.

export const NAV = {
  financas: {
    label: 'Finanças',
    icon: 'Wallet',
    groups: [
      { label: 'Visão', items: [
        { key: 'overview', label: 'Visão Geral', icon: 'LayoutDashboard' },
      ] },
      { label: 'Lançamentos', items: [
        { key: 'txns', label: 'Transações', icon: 'ReceiptText' },
        { key: 'review', label: 'Revisar', icon: 'ListChecks', badge: 'pending' },
        { key: 'rules', label: 'Regras', icon: 'Wand2' },
        { key: 'movs', label: 'Movimentações', icon: 'ArrowLeftRight' },
      ] },
      { label: 'Organização', items: [
        { key: 'cats', label: 'Categorias', icon: 'Shapes' },
        { key: 'tags', label: 'Tags', icon: 'Tag' },
      ] },
      { label: 'Planejamento', items: [
        { key: 'plan', label: 'Planejamento', icon: 'Target' },
        { key: 'poup', label: 'Poupança', icon: 'PiggyBank' },
        { key: 'tools', label: 'Ferramentas', icon: 'Calculator' },
      ] },
    ],
    // atalhos da barra inferior do celular (o resto fica no "Mais")
    shortcuts: ['overview', 'txns', 'review', 'cats'],
  },
  investimentos: {
    label: 'Investimentos',
    icon: 'TrendingUp',
    groups: [
      { label: 'Investimentos', items: [
        { key: 'visao', label: 'Visão Geral', icon: 'LayoutDashboard' },
        { key: 'carteira', label: 'Carteira', icon: 'Briefcase' },
        { key: 'aporte', label: 'Aporte', icon: 'CirclePlus' },
        { key: 'caixinhas', label: 'Reservas e saldo', short: 'Reservas', icon: 'Vault' },
        { key: 'operacoes', label: 'Movimentações', short: 'Operações', icon: 'History' },
        { key: 'simulador', label: 'Simulador', icon: 'FlaskConical' },
      ] },
    ],
    shortcuts: ['visao', 'carteira', 'aporte', 'caixinhas'],
  },
}

export const navItems = (space) => NAV[space].groups.flatMap((group) => group.items)

// abas válidas por espaço; a primeira é a padrão
export const SPACES = Object.fromEntries(
  Object.keys(NAV).map((space) => [space, navItems(space).map((item) => item.key)]))

export function findItem(space, tab) {
  return navItems(space).find((item) => item.key === tab) || null
}

// "#/investimentos/carteira" → { space, tab }; qualquer coisa inválida cai no padrão
export function parseHash(hash) {
  const [, space, tab] = String(hash || '').split('/')
  const valid = SPACES[space] ? space : 'financas'
  return { space: valid, tab: SPACES[valid].includes(tab) ? tab : SPACES[valid][0] }
}

export const hashFor = (space, tab) => `#/${space}/${tab || SPACES[space][0]}`
