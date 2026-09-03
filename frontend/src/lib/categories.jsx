import {
  Utensils, Car, Home, HeartPulse, Gamepad2, ShoppingBag, Wrench,
  Briefcase, GraduationCap, Landmark, ArrowLeftRight, TrendingUp,
  PiggyBank, Award, Users, Banknote, Shapes, HelpCircle,
  ShoppingCart, Plane, HeartHandshake, Receipt, Shirt, Gift, Dog,
  CarTaxiFront, Undo2,
} from 'lucide-react'

// Registry de ícones: nome (vindo da planilha) -> componente.
const ICONS = {
  Utensils, Car, Home, HeartPulse, Gamepad2, ShoppingBag, Wrench,
  Briefcase, GraduationCap, Landmark, ArrowLeftRight, TrendingUp,
  PiggyBank, Award, Users, Banknote, Shapes, ShoppingCart, Plane,
  HeartHandshake, Receipt, Shirt, Gift, Dog, CarTaxiFront, Undo2,
}

const FALLBACK = { Icon: Shapes, color: '#8a97a6' }

// Cor/ícone por categoria vêm da aba Taxonomy (dashboard.category_meta).
// Variável de módulo em vez de contexto: o dado é global, carrega uma vez, e
// assim os 12 componentes que chamam catMeta() não precisam mudar.
let META = {}

export function setCategoryMeta(meta) {
  META = meta || {}
}

export const UNCAT = { Icon: HelpCircle, color: '#e0a93b' }

export const catMeta = (name) => {
  const m = META[name]
  if (!m) return FALLBACK
  return { Icon: ICONS[m.icon] || FALLBACK.Icon, color: m.color || FALLBACK.color }
}
export const catColor = (name) => catMeta(name).color

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
  const cls = `inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap
    rounded-full border font-medium
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
        <I className={`${isz} shrink-0`} />
        {uncategorized ? 'Sem categoria' : category}
      </Cmp>
      {subcategory && !uncategorized && (
        <span className="text-[12px] text-faint">{subcategory}</span>
      )}
    </span>
  )
}
