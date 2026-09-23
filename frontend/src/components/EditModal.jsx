import { useMemo, useState } from 'react'
import { Modal } from './ui/Modal.jsx'
import { Button, Spinner } from './ui/primitives.jsx'
import { inputCls } from './ui/MultiSelect.jsx'
import { useToast } from './ui/Toast.jsx'
import { signedBrl, brl, dayMonth } from '../lib/format.js'
import { SensitiveAmount } from './ui/SensitiveValue.jsx'
import {
  Pencil, Tags, Sparkles, MessageSquare, SplitSquareHorizontal, Plus, Trash2,
  Users, EyeOff, Eye, X, StickyNote, Link2,
} from 'lucide-react'

const MODES = [
  { k: 'value', label: 'Só este(s)', icon: Pencil,
    hint: 'Grava a categoria só nestes lançamentos.' },
  { k: 'tags', label: 'Tags', icon: Tags,
    hint: 'Adiciona ou remove tags sem mexer na categoria.' },
  { k: 'rule', label: 'Editar + criar regra', icon: Sparkles,
    hint: 'Cria uma regra e aplica em todo o histórico.' },
  { k: 'split', label: 'Dividir', icon: SplitSquareHorizontal, single: true,
    hint: 'Sua parte conta no fluxo; a de outra pessoa vai pra Terceiros '
      + 'e fecha com o reembolso.' },
  { k: 'queue', label: 'Mandar pro Claude', icon: MessageSquare,
    hint: 'Envia pra fila com uma nota; o Claude decide na conversa.' },
]
const FIELDS = [
  ['merchant_name', 'Lojista'],
  ['counterparty', 'Contraparte'],
  ['description', 'Descrição'],
]
const AMOUNT_MODES = [
  ['any', 'qualquer'], ['eq', 'igual a'], ['max', 'até'],
  ['min', 'a partir de'], ['between', 'entre'],
]
const MATCHES = [
  ['contains', 'contém'], ['exact', 'igual a'],
  ['startswith', 'começa com'], ['regex', 'regex'],
]

export function EditModal({ open, onClose, txns, taxonomy, allTxns, availableTags,
  knownSettlers, onSaved, saveEdit }) {
  const t = useToast()
  const first = txns[0] || {}
  const [mode, setMode] = useState('value')
  const [cat, setCat] = useState(first.category || '')
  const [sub, setSub] = useState(first.subcategory || '')
  const [field, setField] = useState('description')
  const [match, setMatch] = useState('contains')
  const [value, setValue] = useState('')
  const [byType, setByType] = useState(false)
  const [ruleExcl, setRuleExcl] = useState(false)
  const [amountMode, setAmountMode] = useState('any')
  const [amountFrom, setAmountFrom] = useState(
    () => String(Math.abs(txns[0]?.signed_amount || 0)))
  const [amountTo, setAmountTo] = useState('')
  const [instruction, setInstruction] = useState('')
  const [propagateNote, setPropagateNote] = useState(false)
  const [note, setNote] = useState(
    () => (txns.length === 1 ? txns[0]?.note : '') || '')
  const [settleWith, setSettleWith] = useState(
    () => (txns.length === 1 ? txns[0]?.settle_with : '') || '')
  const [settleTouched, setSettleTouched] = useState(false)
  const [tagInput, setTagInput] = useState('')
  const [tagsToAdd, setTagsToAdd] = useState([])
  const [tagsToRemove, setTagsToRemove] = useState([])
  const [saving, setSaving] = useState(false)
  const [excluding, setExcluding] = useState(false)

  const single = txns.length === 1
  const allExcluded = txns.length > 0 && txns.every((x) => x.excluded)
  const absTotal = Math.abs(first.signed_amount || 0)
  const sign = (first.signed_amount || 0) < 0 ? -1 : 1
  const existingSplits = single && Array.isArray(first.splits) ? first.splits : null
  const [rows, setRows] = useState(() => existingSplits
    ? existingSplits.map((s) => ({ amt: String(Math.abs(s.amount)),
        category: s.category || '', subcategory: s.subcategory || '',
        note: s.note || '', settle_with: s.settle_with || '' }))
    : [{ amt: String(absTotal), category: first.category || '',
        subcategory: first.subcategory || '', note: '' }])

  const cats = Object.keys(taxonomy || {})
  const subs = taxonomy?.[cat] || []
  const thirdPartyCat = cats.includes('Terceiros') ? 'Terceiros' : 'Compartilhado'
  const settlers = useMemo(() => [...new Set([
    ...(knownSettlers || []),
    ...(allTxns || []).flatMap((x) => [x.settle_with,
      ...(x.splits || []).map((part) => part.settle_with)]),
  ].filter(Boolean))].sort(), [knownSettlers, allTxns])

  const sumAbs = rows.reduce((a, r) => a + (parseFloat(r.amt) || 0), 0)
  const remainder = Math.round((absTotal - sumAbs) * 100) / 100
  const splitOk = single && rows.length >= 2
    && Math.abs(remainder) < 0.01
    && rows.every((r) => parseFloat(r.amt) > 0 && r.category)

  const setRow = (i, k, v) => setRows((rs) =>
    rs.map((r, j) => j === i ? { ...r, ...(k === 'category'
      ? { category: v, subcategory: '' } : { [k]: v }) } : r))
  const addRow = () => setRows((rs) => [...rs,
    { amt: String(Math.max(remainder, 0) || ''), category: '',
      subcategory: '', note: '' }])
  const delRow = (i) => setRows((rs) => rs.filter((_, j) => j !== i))
  const fillFirst = () => setRows((rs) => rs.map((r, j) => j === 0
    ? { ...r, amt: String(Math.round(
        (absTotal - rs.slice(1).reduce((a, x) => a + (+x.amt || 0), 0))
        * 100) / 100) } : r))
  const presetReimburse = () => setRows([
    { amt: '', category: first.category || '',
      subcategory: first.subcategory || '', note: 'minha parte' },
    { amt: '', category: thirdPartyCat,
      subcategory: (taxonomy?.[thirdPartyCat] || [])[0] || '',
      note: 'parte de outra pessoa', settle_with: '' },
  ])

  // valor sugerido para a regra a partir do campo escolhido
  const suggested = useMemo(() => {
    const v = first[field]
    return v || first.description || ''
  }, [field, first])
  const ruleValue = value || suggested

  const amountRange = useMemo(() => {
    const from = amountFrom === '' ? null : Math.abs(+amountFrom)
    const to = amountTo === '' ? null : Math.abs(+amountTo)
    if (amountMode === 'eq') return { min: from, max: from }
    if (amountMode === 'max') return { min: null, max: from }
    if (amountMode === 'min') return { min: from, max: null }
    if (amountMode === 'between') return { min: from, max: to }
    return { min: null, max: null }
  }, [amountMode, amountFrom, amountTo])
  const amountOk = amountMode === 'any' || (amountMode === 'between'
    ? amountRange.min != null && amountRange.max != null
      && amountRange.min <= amountRange.max
    : amountRange.min != null || amountRange.max != null)

  // pré-visualização: quantos lançamentos do mês casariam com a regra
  const preview = useMemo(() => {
    if (mode !== 'rule' || !ruleValue) return null
    const norm = (s) => (s || '').toString()
      .normalize('NFKD').replace(/[̀-ͯ]/g, '')
      .toUpperCase().replace(/\s+/g, ' ').trim()
    const tgt = norm(ruleValue)
    let re = null
    if (match === 'regex') { try { re = new RegExp(ruleValue, 'i') } catch { /* */ } }
    return (allTxns || []).filter((x) => {
      if (byType && x.type !== first.type) return false
      const cents = Math.round(Math.abs(x.signed_amount || 0) * 100)
      if (amountRange.min != null && cents < Math.round(amountRange.min * 100)) return false
      if (amountRange.max != null && cents > Math.round(amountRange.max * 100)) return false
      const f = norm(x[field])
      if (match === 'contains') return f.includes(tgt)
      if (match === 'exact') return f === tgt
      if (match === 'startswith') return f.startsWith(tgt)
      if (match === 'regex') return re && re.test(x[field] || '')
      return false
    }).length
  }, [mode, ruleValue, match, field, byType, amountRange, allTxns, first])

  const propagating = mode === 'rule' && propagateNote && !!note.trim()
  const ids = txns.map((x) => x.id)
  const usedTags = useMemo(() => [...new Set(
    txns.flatMap((transaction) => transaction.tags || []))].sort(), [txns])
  const suggestedTags = (availableTags || []).filter(
    (tag) => !usedTags.includes(tag) && !tagsToAdd.includes(tag))
  const addTag = (rawTag) => {
    const tag = rawTag.trim().replace(/\s+/g, ' ')
    if (!tag) return
    setTagsToRemove((tags) => tags.filter((value) => value !== tag))
    setTagsToAdd((tags) => tags.includes(tag) ? tags : [...tags, tag])
    setTagInput('')
  }
  const removeTag = (tag) => {
    setTagsToAdd((tags) => tags.filter((value) => value !== tag))
    setTagsToRemove((tags) => tags.includes(tag) ? tags : [...tags, tag])
  }
  const canSave = mode === 'queue'
    ? note.trim().length > 0 || !!cat
    : mode === 'tags'
      ? tagsToAdd.length > 0 || tagsToRemove.length > 0
    : mode === 'split'
      ? splitOk
      : !!cat && (mode !== 'rule' || (!!ruleValue && amountOk))

  async function save() {
    setSaving(true)
    try {
      const payload = {
        mode, ids,
        category: cat || null,
        subcategory: sub || null,
        note: note.trim(),
        samples: txns.slice(0, 6).map((x) => ({
          date: x.date, description: x.description, signed_amount: x.signed_amount,
        })),
      }
      if (mode === 'tags') {
        payload.category = null
        payload.note = null
        payload.tags_add = tagsToAdd
        payload.tags_remove = tagsToRemove
      }
      if (mode === 'rule') {
        payload.rule = {
          field, match, value: ruleValue,
          ...(byType ? { type: first.type } : {}),
          ...(amountRange.min != null ? { amount_abs_min: amountRange.min } : {}),
          ...(amountRange.max != null ? { amount_abs_max: amountRange.max } : {}),
          ...(propagating ? { note: note.trim(), propagate_note: true } : {}),
          ...(instruction.trim() ? { instruction: instruction.trim() } : {}),
        }
        if (ruleExcl) payload.excluded = true
      }
      if ((mode === 'value' || mode === 'rule') && settleTouched) {
        payload.settle_with = settleWith.trim() || null
      }
      if (mode === 'split') {
        payload.category = null
        payload.splits = rows.map((r) => ({
          amount: sign * Math.abs(parseFloat(r.amt) || 0),
          category: r.category, subcategory: r.subcategory || null,
          note: r.note || '',
          ...(r.settle_with?.trim() ? { settle_with: r.settle_with.trim() } : {}),
        }))
      }
      await saveEdit(payload)
      if (mode === 'queue') {
        t(`${ids.length} lançamento(s) na Fila do Claude.\n` +
          'Veja/edite em "Fila do Claude" (topo) ou na aba Revisar.', 'success', 6000)
      } else if (mode === 'tags') {
        t(`Tags atualizadas em ${ids.length} lançamento(s).`, 'success')
      } else if (mode === 'split') {
        t(`Lançamento dividido em ${rows.length} partes.`, 'success')
      } else if (mode === 'rule') {
        t('Regra salva. Os outros lançamentos que casarem atualizam em instantes.',
          'success')
      } else {
        t(`Aplicado a ${ids.length} lançamento(s).`, 'success')
      }
      if (mode === 'queue') onSaved(false)
      onClose()
    } catch (e) {
      t('Erro ao salvar: ' + e.message, 'error', 7000)
    } finally {
      setSaving(false)
    }
  }

  async function removeReimbursement(link) {
    try {
      await saveEdit({ mode: 'reimburse', ids: [first.id, link.other_id],
        remove: [link.id] })
      t('Abatimento removido.', 'success')
      onClose()
    } catch (e) {
      t('Erro: ' + e.message, 'error', 7000)
    }
  }

  async function toggleExclude() {
    setExcluding(true)
    try {
      await saveEdit({ mode: 'exclude', ids, excluded: !allExcluded })
      t(allExcluded
        ? `${ids.length} lançamento(s) restaurado(s).`
        : `${ids.length} lançamento(s) rasurado(s).`,
        'success')
      onClose()
    } catch (e) {
      t('Erro: ' + e.message, 'error', 7000)
    } finally {
      setExcluding(false)
    }
  }

  return (
    <Modal open={open} onOpenChange={(o) => !o && onClose()}
      width="max-w-xl"
      title={txns.length > 1
        ? `Editar ${txns.length} lançamentos` : 'Editar lançamento'}
      sub={txns.length === 1
        ? <>{first.description}<span className="tnum ml-2 text-faint">
          {signedBrl(first.signed_amount)}</span></>
        : <><SensitiveAmount>{signedBrl(
          txns.reduce((a, x) => a + x.signed_amount, 0))}</SensitiveAmount>{' '}
          no total</>}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button variant="primary" disabled={!canSave || saving} onClick={save}>
            {saving ? 'Salvando…'
              : mode === 'queue' ? 'Enviar pra fila'
                : mode === 'split' ? 'Dividir'
                  : mode === 'rule' ? 'Salvar + aprender' : 'Salvar'}
          </Button>
        </>
      }>
      {/* modo */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {MODES.filter((m) => !m.single || single).map((m) => {
          const I = m.icon
          return (
            <button key={m.k} onClick={() => setMode(m.k)}
              className={`rounded-xl border px-3 py-2.5 text-left transition
                ${mode === m.k
                  ? 'border-brand/50 bg-brand/10'
                  : 'border-border bg-surface2 hover:border-faint'}`}>
              <I className={`size-4 ${mode === m.k ? 'text-brand' : 'text-muted'}`} />
              <div className="mt-1.5 text-[13px] font-semibold">{m.label}</div>
            </button>
          )
        })}
      </div>
      <p className="mt-2 text-[12px] text-muted">
        {MODES.find((m) => m.k === mode)?.hint}
      </p>

      {txns.length > 1 && (
        <div className="mt-4 max-h-28 overflow-y-auto rounded-xl border
          border-border bg-surface2/60 p-2 text-[12px] text-muted">
          {txns.slice(0, 8).map((x) => (
            <div key={x.id} className="flex justify-between gap-3 px-1 py-0.5">
              <span className="truncate">
                <span className="tnum mr-2 text-faint">{dayMonth(x.date)}</span>
                {x.description}
              </span>
              <span className="tnum">{signedBrl(x.signed_amount)}</span>
            </div>
          ))}
          {txns.length > 8 && <div className="px-1 pt-1">
            +{txns.length - 8} outros…</div>}
        </div>
      )}

      {mode === 'tags' && (
        <div className="mt-4 flex flex-col gap-4">
          <div>
            <div className="text-[12px] font-semibold text-muted">
              Adicionar tags
            </div>
            <div className="mt-2 flex gap-2">
              <input value={tagInput}
                onChange={(event) => setTagInput(event.target.value)}
                maxLength={80}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    addTag(tagInput)
                  }
                }}
                placeholder="Digite uma tag"
                className={inputCls('min-w-0 flex-1')} />
              <Button onClick={() => addTag(tagInput)} disabled={!tagInput.trim()}>
                <Plus className="size-4" /> Adicionar
              </Button>
            </div>
            {tagsToAdd.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {tagsToAdd.map((tag) => (
                  <button key={tag} onClick={() => setTagsToAdd(
                    (tags) => tags.filter((value) => value !== tag))}
                    className="inline-flex items-center gap-1 rounded-full border
                      border-blue/40 bg-blue/10 px-2 py-1 text-[12px] text-blue">
                    {tag}<X className="size-3" />
                  </button>
                ))}
              </div>
            )}
            {suggestedTags.length > 0 && (
              <div className="mt-3">
                <div className="text-[11px] text-faint">Tags já utilizadas</div>
                <div className="mt-1.5 flex max-h-24 flex-wrap gap-1.5 overflow-y-auto">
                  {suggestedTags.map((tag) => (
                    <button key={tag} onClick={() => addTag(tag)}
                      className="rounded-full border border-border bg-surface2
                        px-2 py-1 text-[12px] text-muted hover:border-faint
                        hover:text-text">
                      <Plus className="mr-1 inline size-3" />{tag}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
          <div>
            <div className="text-[12px] font-semibold text-muted">
              Tags presentes na seleção
            </div>
            {usedTags.length ? (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {usedTags.map((tag) => {
                  const removed = tagsToRemove.includes(tag)
                  return (
                    <button key={tag} onClick={() => removed
                      ? setTagsToRemove((tags) => tags.filter(
                          (value) => value !== tag))
                      : removeTag(tag)}
                      className={`inline-flex items-center gap-1 rounded-full border
                        px-2 py-1 text-[12px] ${removed
                          ? 'border-red/40 bg-red/10 text-red line-through'
                          : 'border-border bg-surface2 text-muted hover:text-red'}`}>
                      {tag}<X className="size-3" />
                    </button>
                  )
                })}
              </div>
            ) : (
              <p className="mt-2 text-[12px] text-faint">
                Nenhum lançamento selecionado possui tags.
              </p>
            )}
          </div>
        </div>
      )}

      {/* dividir lançamento */}
      {mode === 'split' && (
        <div className="mt-4">
          <div className="mb-2 flex items-center justify-between text-[12px]">
            <span className="text-muted">Total do lançamento</span>
            <span className="tnum font-semibold">
              {signedBrl(first.signed_amount)}</span>
          </div>
          <div className="flex flex-col gap-2">
            {rows.map((r, i) => (
              <div key={i} className="rounded-xl border border-border
                bg-surface2/50 p-2.5">
                <div className="flex gap-2">
                  <input type="number" value={r.amt}
                    onChange={(e) => setRow(i, 'amt', e.target.value)}
                    placeholder="valor" className={inputCls('w-28')} />
                  <select value={r.category}
                    onChange={(e) => setRow(i, 'category', e.target.value)}
                    className={inputCls('flex-1')}>
                    <option value="">categoria…</option>
                    {cats.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                  <select value={r.subcategory}
                    onChange={(e) => setRow(i, 'subcategory', e.target.value)}
                    disabled={!(taxonomy?.[r.category] || []).length}
                    className={inputCls('flex-1')}>
                    <option value="">—</option>
                    {(taxonomy?.[r.category] || []).map((s) =>
                      <option key={s} value={s}>{s}</option>)}
                  </select>
                  {rows.length > 1 && (
                    <button onClick={() => delRow(i)}
                      className="rounded-lg px-1.5 text-muted hover:text-red">
                      <Trash2 className="size-4" /></button>
                  )}
                </div>
                <div className="mt-2 flex gap-2">
                  <input value={r.note}
                    onChange={(e) => setRow(i, 'note', e.target.value)}
                    placeholder="nota (opcional)"
                    className={inputCls('min-w-0 flex-1')} />
                  <input value={r.settle_with || ''} list="settlers"
                    onChange={(e) => setRow(i, 'settle_with', e.target.value)}
                    placeholder="com quem (opcional)"
                    className={inputCls('w-44')} />
                </div>
              </div>
            ))}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Button variant="ghost" onClick={addRow}>
              <Plus className="size-4" /> parte</Button>
            <Button variant="ghost" onClick={fillFirst}>
              resto na 1ª parte</Button>
            <Button variant="ghost" onClick={presetReimburse}>
              <Users className="size-4" /> parte de outra pessoa</Button>
            <span className={`ml-auto text-[12px] tnum ${
              Math.abs(remainder) < 0.01 ? 'text-green' : 'text-amber'}`}>
              {Math.abs(remainder) < 0.01
                ? 'fecha ✓'
                : `falta alocar ${brl(remainder)}`}
            </span>
          </div>
        </div>
      )}

      {/* categoria / subcategoria */}
      {(mode === 'value' || mode === 'rule' || mode === 'queue') && (
        <div className="mt-4 grid grid-cols-2 gap-3">
          <label className="text-[12px] text-muted">
            Categoria{mode === 'queue' && ' (opcional)'}
            <select value={cat}
              onChange={(e) => { setCat(e.target.value); setSub('') }}
              className={inputCls('mt-1 w-full')}>
              <option value="">—</option>
              {cats.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
          <label className="text-[12px] text-muted">
            Subcategoria
            <select value={sub} onChange={(e) => setSub(e.target.value)}
              disabled={!subs.length} className={inputCls('mt-1 w-full')}>
              <option value="">—</option>
              {subs.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
        </div>
      )}

      {(mode === 'value' || mode === 'rule') && (
        <label className="mt-3 block text-[12px] text-muted">
          Com quem
          <span className="text-faint"> (opcional, quem vai acertar esse valor com você)</span>
          <input value={settleWith} list="settlers"
            onChange={(e) => { setSettleWith(e.target.value); setSettleTouched(true) }}
            placeholder={txns.length > 1 ? 'deixe vazio para não alterar' : 'Ex.: FUNAPE, Julia'}
            className={inputCls('mt-1 w-full')} />
        </label>
      )}
      <datalist id="settlers">
        {settlers.map((name) => <option key={name} value={name} />)}
      </datalist>

      {/* construtor de regra */}
      {mode === 'rule' && (
        <div className="mt-4 rounded-xl border border-border bg-surface2/50 p-3">
          <div className="text-[12px] font-semibold text-muted">Regra</div>
          <div className="mt-2 grid grid-cols-[1fr_1fr] gap-2">
            <select value={field} onChange={(e) => setField(e.target.value)}
              className={inputCls()}>
              {FIELDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
            <select value={match} onChange={(e) => setMatch(e.target.value)}
              className={inputCls()}>
              {MATCHES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </div>
          <input value={value} onChange={(e) => setValue(e.target.value)}
            placeholder={suggested}
            className={inputCls('mt-2 w-full')} />
          <div className="mt-2 flex items-center gap-2 text-[12px] text-muted">
            <span className="w-10 shrink-0">Valor</span>
            <select value={amountMode}
              onChange={(e) => setAmountMode(e.target.value)}
              className={inputCls('w-32')}>
              {AMOUNT_MODES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
            {amountMode !== 'any' && (
              <input type="number" step="0.01" min="0" value={amountFrom}
                onChange={(e) => setAmountFrom(e.target.value)}
                placeholder="R$" className={inputCls('tnum min-w-0 flex-1')} />
            )}
            {amountMode === 'between' && (
              <>
                <span>e</span>
                <input type="number" step="0.01" min="0" value={amountTo}
                  onChange={(e) => setAmountTo(e.target.value)}
                  placeholder="R$" className={inputCls('tnum min-w-0 flex-1')} />
              </>
            )}
          </div>
          <label className="mt-2 flex items-center gap-2 text-[12px] text-muted">
            <input type="checkbox" checked={byType}
              onChange={(e) => setByType(e.target.checked)} />
            <span>Só quando o tipo for {first.type}</span>
          </label>
          <label className={`mt-2 flex items-center gap-2 rounded-lg border px-2
            py-1.5 text-[12px] transition ${ruleExcl
              ? 'border-amber/40 bg-amber/5 text-amber'
              : 'border-transparent text-muted'}`}>
            <input type="checkbox" checked={ruleExcl}
              onChange={(e) => setRuleExcl(e.target.checked)} />
            <EyeOff className="size-3.5 shrink-0" />
            <span>Rasurar tudo que casar (ex.: compromissadas)</span>
          </label>
          {preview != null && (
            <p className="mt-2 text-[12px] text-blue">
              ≈ {preview} lançamento(s) neste mês. Aplica em todo o histórico.
            </p>
          )}
        </div>
      )}

      {mode !== 'queue' && mode !== 'tags' && (
        <label className="mt-4 block text-[12px] text-muted">
          Nota
          <span className="text-faint"> (aparece no hover
            {txns.length > 1 && !propagating ? ', vale para todos' : ''})</span>
          <textarea value={note} onChange={(e) => setNote(e.target.value)}
            rows={3}
            placeholder="Ex.: dividi a conta com um amigo; jantar de aniversário…"
            className={inputCls('mt-1 w-full resize-y')} />
        </label>
      )}
      {mode === 'rule' && (
        <label className={`mt-1 flex items-center gap-2 rounded-lg border px-2
          py-1.5 text-[12px] transition ${!note.trim()
            ? 'cursor-not-allowed border-transparent text-faint'
            : propagateNote
              ? 'border-brand/40 bg-brand/5 text-brand'
              : 'border-transparent text-muted'}`}>
          <input type="checkbox" checked={propagateNote}
            disabled={!note.trim()}
            onChange={(e) => setPropagateNote(e.target.checked)} />
          <StickyNote className="size-3.5 shrink-0" />
          <span>Manter junto com a regra (vale também para os próximos)</span>
        </label>
      )}
      {mode === 'rule' && (
        <label className="mt-4 block text-[12px] text-muted">
          Instrução pro Claude
          <span className="text-faint"> (lida a cada sync, nunca aparece no hover)</span>
          <textarea value={instruction}
            onChange={(e) => setInstruction(e.target.value)} rows={2}
            placeholder="Ex.: se o IOF veio separado no mesmo dia, não somar 3,50"
            className={inputCls('mt-1 w-full resize-y')} />
        </label>
      )}

      {/* nota para o Claude */}
      {mode === 'queue' && (
        <label className="mt-4 block text-[12px] text-muted">
          Nota pro Claude (o que você quer que eu faça)
          <textarea value={note} onChange={(e) => setNote(e.target.value)}
            rows={4} autoFocus
            placeholder="Ex.: esse PIX foi reembolso do escritório do Hugo,
trata como Compartilhado e anula com o que ele me mandou…"
            className={inputCls('mt-1 w-full resize-y')} />
        </label>
      )}

      {single && first.reimbursed?.links?.length > 0 && (
        <div className="mt-4 rounded-xl border border-green/30 bg-green/5 px-3 py-2.5">
          <div className="flex items-center gap-1.5 text-[12px] font-semibold text-green">
            <Link2 className="size-3.5" /> Abatimentos
          </div>
          {first.reimbursed.links.map((link) => (
            <div key={link.id} className="mt-1.5 flex items-center justify-between
              gap-3 text-[12px] text-muted">
              <span className="min-w-0 truncate">
                {link.side === 'credit' ? 'Abate' : 'Abatido por'}{' '}
                <span className="text-text">{link.other_description}</span>
                {link.other_date && <span className="tnum ml-1.5 text-faint">
                  {dayMonth(link.other_date)}</span>}
              </span>
              <span className="flex shrink-0 items-center gap-2">
                <span className="tnum">{brl(link.amount)}</span>
                <button onClick={() => removeReimbursement(link)}
                  disabled={String(link.id).startsWith('pendente')}
                  title="Remover vínculo"
                  className="rounded-lg p-1 text-muted hover:text-red
                    disabled:opacity-40">
                  <Trash2 className="size-3.5" />
                </button>
              </span>
            </div>
          ))}
        </div>
      )}

      {/* rasurar: tira de todos os relatórios, reversível */}
      {mode !== 'queue' && mode !== 'tags' && (
        <div className={`mt-4 flex items-center justify-between gap-3 rounded-xl
          border px-3 py-2.5 ${allExcluded
            ? 'border-amber/40 bg-amber/5' : 'border-border bg-surface2/40'}`}>
          <div className="text-[12px] text-muted">
            <div className="flex items-center gap-1.5 font-semibold text-text">
              {allExcluded
                ? <><Eye className="size-3.5 text-amber" /> Rasurado</>
                : <><EyeOff className="size-3.5" /> Rasurar</>}
            </div>
            <p className="mt-0.5">
              {allExcluded
                ? 'Fora dos relatórios. Restaure para voltar a contar.'
                : 'Tira de todos os relatórios. Reversível.'}
            </p>
          </div>
          <button onClick={toggleExclude} disabled={excluding}
            className={`inline-flex shrink-0 items-center gap-1.5 rounded-lg border
              px-3 py-1.5 text-[12px] font-semibold transition
              disabled:cursor-wait disabled:opacity-70 ${allExcluded
                ? 'border-amber/50 bg-amber/10 text-amber hover:bg-amber/20'
                : 'border-border text-muted hover:border-faint hover:text-text'}`}>
            {excluding && <Spinner className="size-3.5" />}
            {excluding
              ? (allExcluded ? 'Restaurando…' : 'Rasurando…')
              : allExcluded ? 'Restaurar' : 'Rasurar'}
          </button>
        </div>
      )}
    </Modal>
  )
}
