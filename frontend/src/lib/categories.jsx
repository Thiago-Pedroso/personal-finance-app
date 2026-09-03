import {
  Utensils, Car, Home, HeartPulse, Gamepad2, ShoppingBag, Wrench,
  Briefcase, GraduationCap, Landmark, ArrowLeftRight, TrendingUp,
  PiggyBank, Award, Users, Banknote, Shapes, HelpCircle,
  ShoppingCart, Plane, HeartHandshake, Receipt, Shirt, Gift, Dog,
  CarTaxiFront, Undo2,
} from 'lucide-react'
import {
  derivedAccent, taxonomyChipStyle, validHexColor,
} from './colors.js'

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
let SUBCATEGORY_META = {}

export function setCategoryMeta(meta, subcategoryMeta) {
  META = meta || {}
  SUBCATEGORY_META = subcategoryMeta || {}
}

export const UNCAT = { Icon: HelpCircle, color: '#e0a93b' }

export const catMeta = (name) => {
  const m = META[name]
  if (!m) return FALLBACK
  const color = validHexColor(m.color, FALLBACK.color)
  return { Icon: ICONS[m.icon] || FALLBACK.Icon, color }
}
export const catColor = (name) => catMeta(name).color

export function subcategoryMeta(category, subcategory) {
  const configured = SUBCATEGORY_META[category]?.[subcategory] || {}
  const color = validHexColor(configured.color, null)
    || derivedAccent(catColor(category), `${category}:${subcategory}`)
  return { Icon: configured.icon ? ICONS[configured.icon] || null : null, color }
}

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
function TaxonomyChip({ label, meta, size, onClick, title }) {
  const Icon = meta.Icon
  const px = size === 'xs' ? 'px-1.5 py-0.5 text-[11px]'
    : 'px-2 py-1 text-[12px]'
  const isz = size === 'xs' ? 'size-3' : 'size-3.5'
  const cls = `inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap
    rounded-full border font-medium
    ${px} ${onClick ? 'cursor-pointer hover:brightness-125 transition' : ''}`
  const Cmp = onClick ? 'button' : 'span'
  return (
    <Cmp className={cls} style={taxonomyChipStyle(meta.color)} onClick={onClick}
      title={title || label}>
      {Icon && <Icon className={`${isz} shrink-0`} />}
      {label}
    </Cmp>
  )
}

export function SubcategoryTag({ category, subcategory, size = 'sm', onClick,
  title }) {
  return <TaxonomyChip label={subcategory}
    meta={subcategoryMeta(category, subcategory)} size={size}
    onClick={onClick} title={title} />
}

export function CategoryTag({ category, subcategory, uncategorized, hint,
  size = 'sm', onClick, onSubcategoryClick, title }) {
  const label = uncategorized ? 'Sem categoria' : category
  const meta = uncategorized ? UNCAT : catMeta(category)
  return (
    <span className="inline-flex items-center gap-1.5">
      <TaxonomyChip label={label} meta={meta} size={size} onClick={onClick}
        title={title || hint || label} />
      {subcategory && !uncategorized && (
        <SubcategoryTag category={category} subcategory={subcategory} size={size}
          onClick={onSubcategoryClick} title={title} />
      )}
    </span>
  )
}
