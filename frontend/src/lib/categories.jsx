import {
  Utensils, Car, Home, HeartPulse, Gamepad2, ShoppingBag, Wrench,
  Briefcase, GraduationCap, Landmark, ArrowLeftRight, TrendingUp,
  PiggyBank, Award, Users, Banknote, Shapes, HelpCircle,
} from 'lucide-react'

// ícone + cor por categoria (nomes EXATOS do taxonomy.yaml)
export const CAT = {
  'Alimentação':    { Icon: Utensils,      color: '#f4685f' },
  'Transporte':     { Icon: Car,           color: '#5aa2ff' },
  'Moradia':        { Icon: Home,          color: '#b08cff' },
  'Saúde':          { Icon: HeartPulse,    color: '#36c98b' },
  'Lazer':          { Icon: Gamepad2,      color: '#ec6cb9' },
  'Compras':        { Icon: ShoppingBag,   color: '#ffb35c' },
  'Serviços':       { Icon: Wrench,        color: '#4dd0c4' },
  'Trabalho':       { Icon: Briefcase,     color: '#79b8ff' },
  'Educação':       { Icon: GraduationCap, color: '#c98bff' },
  'Impostos/Taxas': { Icon: Landmark,      color: '#e0a93b' },
  'Transferências': { Icon: ArrowLeftRight, color: '#8a97a6' },
  'Investimentos':  { Icon: TrendingUp,    color: '#7ee7a8' },
  'Reserva':        { Icon: PiggyBank,     color: '#ffd166' },
  'Formatura':      { Icon: Award,         color: '#ff8fab' },
  'Compartilhado':  { Icon: Users,         color: '#9bd1ff' },
  'Renda':          { Icon: Banknote,      color: '#3fc97f' },
  'Outros':         { Icon: Shapes,        color: '#8a97a6' },
}
export const UNCAT = { Icon: HelpCircle, color: '#e0a93b' }

export const catMeta = (name) => CAT[name] || CAT['Outros']
export const catColor = (name) => (CAT[name] || CAT['Outros']).color

// Tipos de transferência que a Pluggy "chuta" — não são categoria de verdade.
const TYPE_SUBS = new Set(['PIX recebido', 'PIX enviado', 'TED/DOC'])

// Decide o que MOSTRAR. Um palpite da Pluggy (pluggy-map) não confirmado
// não é categoria de verdade → mostra "Sem categoria" (explícito p/ agir).
export function effectiveCategory(t) {
  if (t?.splits?.length) return { kind: 'split', splits: t.splits }
  const guess = t?.category_source === 'pluggy-map' && !t?.reviewed
    && (!t.category || TYPE_SUBS.has(t.subcategory))
  if (!t?.category || guess) {
    return { kind: 'uncat', label: 'Sem categoria',
      hint: guess ? 'Palpite da Pluggy — precisa categorizar' : null }
  }
  return { kind: 'cat', label: t.category, subcategory: t.subcategory,
    meta: catMeta(t.category) }
}

// Chip: ícone colorido + nome. `onClick` torna clicável (filtrar/drill).
export function CategoryTag({ category, subcategory, uncategorized, hint,
  size = 'sm', onClick, title }) {
  const meta = uncategorized ? UNCAT : catMeta(category)
  const I = meta.Icon
  const px = size === 'xs' ? 'px-1.5 py-0.5 text-[11px]'
    : 'px-2 py-1 text-[12px]'
  const isz = size === 'xs' ? 'size-3' : 'size-3.5'
  const cls = `inline-flex items-center gap-1.5 rounded-full border font-medium
    ${px} ${onClick ? 'cursor-pointer hover:brightness-125 transition' : ''}`
  const style = uncategorized
    ? { color: '#e0a93b', borderColor: '#e0a93b55', background: '#e0a93b18' }
    : { color: meta.color, borderColor: meta.color + '55',
        background: meta.color + '1a' }
  const Cmp = onClick ? 'button' : 'span'
  return (
    <span className="inline-flex items-center gap-1.5">
      <Cmp className={cls} style={style} onClick={onClick}
        title={title || hint || category || 'Sem categoria'}>
        <I className={isz} />
        {uncategorized ? 'Sem categoria' : category}
      </Cmp>
      {subcategory && !uncategorized && (
        <span className="text-[12px] text-faint">{subcategory}</span>
      )}
    </span>
  )
}
