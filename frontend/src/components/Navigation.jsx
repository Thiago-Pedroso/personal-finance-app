import { useEffect, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import {
  ArrowLeftRight, Briefcase, Calculator, CalendarClock, CirclePlus, CreditCard, Ellipsis,
  FlaskConical,
  HandCoins, History, Landmark, LayoutDashboard, ListChecks, PanelLeftClose, PanelLeftOpen,
  PiggyBank, ReceiptText, Repeat, Scale, Shapes, Tag, Target, TrendingUp, Users, Vault,
  Wallet, Wand2, X,
} from 'lucide-react'
import { NAV, findItem } from '../lib/nav.js'

const ICONS = {
  ArrowLeftRight, Briefcase, Calculator, CalendarClock, CirclePlus, CreditCard, FlaskConical, HandCoins,
  History, Landmark, LayoutDashboard, ListChecks, PiggyBank, ReceiptText, Repeat, Scale,
  Shapes, Tag, Target, TrendingUp, Users, Vault, Wallet, Wand2,
}
const Icon = ({ name, className = 'size-[18px]' }) => {
  const C = ICONS[name] || LayoutDashboard
  return <C className={`shrink-0 ${className}`} aria-hidden="true" />
}

const COLLAPSE_KEY = 'finance.sidebar.collapsed'

function Count({ value, className = '' }) {
  if (!value) return null
  return (
    <span className={`rounded-full bg-amber/20 px-1.5 text-[11px] font-bold tabular-nums
      text-amber ${className}`}>{value}</span>
  )
}

// Finanças | Investimentos: o contador de pendências de cada lado fica sempre à vista
function SpaceSwitch({ space, onGo, badges, collapsed, stacked = collapsed }) {
  return (
    <div className={`grid gap-1 rounded-xl border border-border bg-surface2/50 p-1 ${
      stacked ? 'grid-cols-1' : 'grid-cols-2'}`}>
      {Object.entries(NAV).map(([key, cfg]) => (
        <button key={key} onClick={() => onGo(key)} title={cfg.label}
          aria-pressed={space === key}
          className={`relative flex min-h-9 items-center gap-2 rounded-lg px-2.5
            text-[13px] font-semibold transition ${stacked && !collapsed
              ? 'justify-start' : 'justify-center'} ${space === key
              ? 'bg-brand/15 text-brand-soft ring-1 ring-brand/30'
              : 'text-muted hover:bg-white/5 hover:text-text'}`}>
          <Icon name={cfg.icon} className="size-4" />
          {!collapsed && <span className={`truncate ${stacked ? 'flex-1 text-left' : ''}`}>
            {cfg.label}</span>}
          {collapsed
            ? badges[key] > 0 && <span className="absolute right-1 top-1 size-2 rounded-full
              bg-amber" />
            : <Count value={badges[key]} />}
        </button>
      ))}
    </div>
  )
}

function NavList({ space, tab, onGo, badges, collapsed, onNavigate }) {
  return (
    <nav aria-label="Telas" className="flex flex-col gap-4">
      {NAV[space].groups.map((group) => (
        <div key={group.label}>
          {collapsed
            ? <div className="mx-3 mb-1 border-t border-border/70" />
            : <p className="mb-1 px-3 text-[11px] font-semibold uppercase tracking-wider
                text-faint">{group.label}</p>}
          <ul className="flex flex-col gap-0.5">
            {group.items.map((item) => {
              const active = tab === item.key
              const count = item.badge ? badges[item.badge] : 0
              return (
                <li key={item.key}>
                  <a href={`#/${space}/${item.key}`}
                    onClick={(e) => { e.preventDefault(); onGo(space, item.key); onNavigate?.() }}
                    aria-current={active ? 'page' : undefined}
                    title={collapsed ? item.label : undefined}
                    className={`relative flex min-h-10 items-center gap-3 rounded-lg px-3
                      text-[13.5px] font-medium transition ${collapsed ? 'justify-center' : ''} ${
                      active
                        ? 'bg-brand/12 text-text before:absolute before:inset-y-2 before:left-0 before:w-0.5 before:rounded-full before:bg-brand'
                        : 'text-muted hover:bg-white/5 hover:text-text'}`}>
                    <Icon name={item.icon} />
                    {!collapsed && <span className="min-w-0 flex-1 truncate">{item.label}</span>}
                    {collapsed
                      ? count > 0 && <span className="absolute right-2 top-2 size-2 rounded-full
                        bg-amber" />
                      : <Count value={count} />}
                  </a>
                </li>
              )
            })}
          </ul>
        </div>
      ))}
    </nav>
  )
}

function Brand({ collapsed }) {
  return (
    <div className={`flex items-center gap-2 ${collapsed ? 'justify-center' : ''}`}>
      <span className="grid size-8 shrink-0 place-items-center rounded-xl bg-brand/10
        text-brand ring-1 ring-brand/20"><Wallet className="size-[18px]" /></span>
      {!collapsed && <span className="truncate text-[16px] font-bold tracking-tight">
        Finance Control</span>}
    </div>
  )
}

// Desktop (≥1024px): menu fixo à esquerda, recolhível até ficar só com os ícones.
export function Sidebar({ space, tab, onGo, badges }) {
  const [collapsed, setCollapsed] = useState(
    () => localStorage.getItem(COLLAPSE_KEY) === '1')
  useEffect(() => { localStorage.setItem(COLLAPSE_KEY, collapsed ? '1' : '0') }, [collapsed])

  return (
    <aside className={`sticky top-0 hidden h-dvh shrink-0 flex-col gap-4 overflow-y-auto
      border-r border-border bg-bg/70 px-3 py-5 backdrop-blur-md lg:flex ${
      collapsed ? 'w-[68px]' : 'w-60'}`}>
      <Brand collapsed={collapsed} />
      <SpaceSwitch space={space} onGo={(s) => onGo(s)} badges={badges} collapsed={collapsed}
        stacked />
      <div className="flex-1">
        <NavList space={space} tab={tab} onGo={onGo} badges={badges} collapsed={collapsed} />
      </div>
      <button onClick={() => setCollapsed((c) => !c)}
        className={`flex min-h-9 items-center gap-2 rounded-lg px-3 text-[12.5px] text-muted
          hover:bg-white/5 hover:text-text ${collapsed ? 'justify-center' : ''}`}
        aria-label={collapsed ? 'Expandir menu' : 'Recolher menu'}
        title={collapsed ? 'Expandir menu' : 'Recolher menu'}>
        {collapsed ? <PanelLeftOpen className="size-4" />
          : <><PanelLeftClose className="size-4" /> Recolher</>}
      </button>
    </aside>
  )
}

// Celular: gaveta com o menu inteiro (aberta pelo hambúrguer ou pelo "Mais")
export function NavDrawer({ open, onOpenChange, space, tab, onGo, badges }) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm
          animate-[overlay_.15s_ease-out] lg:hidden" />
        <Dialog.Content className="fixed inset-y-0 left-0 z-50 flex w-[min(300px,86vw)]
          flex-col gap-4 overflow-y-auto border-r border-border bg-bg px-3 pb-6 pt-4
          shadow-2xl focus:outline-none lg:hidden
          pb-[max(1.5rem,env(safe-area-inset-bottom))]">
          <div className="flex items-center justify-between">
            <Brand />
            <Dialog.Close className="rounded-lg p-2.5 text-muted hover:bg-surface2
              hover:text-text" aria-label="Fechar menu"><X className="size-5" /></Dialog.Close>
          </div>
          <Dialog.Title className="sr-only">Menu</Dialog.Title>
          <Dialog.Description className="sr-only">Escolha o espaço e a tela</Dialog.Description>
          <SpaceSwitch space={space} onGo={(s) => onGo(s)} badges={badges} stacked />
          <NavList space={space} tab={tab} onGo={onGo} badges={badges}
            onNavigate={() => onOpenChange(false)} />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

// Celular: 4 atalhos do espaço atual + "Mais", que abre a gaveta
export function BottomBar({ space, tab, onGo, badges, onMore }) {
  const items = NAV[space].shortcuts.map((key) => findItem(space, key))
  const inShortcuts = NAV[space].shortcuts.includes(tab)
  return (
    <nav aria-label="Atalhos" className="fixed inset-x-0 bottom-0 z-30 border-t
      border-border bg-bg/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md lg:hidden">
      <ul className="grid grid-cols-5">
        {items.map((item) => {
          const active = tab === item.key
          const count = item.badge ? badges[item.badge] : 0
          return (
            <li key={item.key} className="min-w-0">
              <a href={`#/${space}/${item.key}`}
                onClick={(e) => { e.preventDefault(); onGo(space, item.key) }}
                aria-current={active ? 'page' : undefined}
                className={`relative flex min-h-14 flex-col items-center justify-center
                  gap-0.5 px-1 text-[10.5px] font-medium ${active
                    ? 'text-brand-soft' : 'text-muted'}`}>
                <Icon name={item.icon} className="size-5" />
                <span className="max-w-full truncate">{item.short || item.label}</span>
                {count > 0 && <span className="absolute left-1/2 top-1.5 ml-1.5 rounded-full
                  bg-amber px-1 text-[9.5px] font-bold leading-[15px] text-bg">
                  {count > 99 ? '99+' : count}</span>}
              </a>
            </li>
          )
        })}
        <li className="min-w-0">
          <button onClick={onMore}
            className={`relative flex min-h-14 w-full flex-col items-center justify-center
              gap-0.5 px-1 text-[10.5px] font-medium ${inShortcuts ? 'text-muted'
                : 'text-brand-soft'}`}>
            <Ellipsis className="size-5" />
            <span>Mais</span>
          </button>
        </li>
      </ul>
    </nav>
  )
}
