import { useMemo, useState } from 'react'
import { Modal } from './ui/Modal.jsx'
import { Button } from './ui/primitives.jsx'
import { inputCls } from './ui/MultiSelect.jsx'
import { useToast } from './ui/Toast.jsx'
import { postEdit } from '../lib/api.js'
import { signedBrl, brl, dayMonth } from '../lib/format.js'
import {
  Tag, Sparkles, MessageSquare, SplitSquareHorizontal, Plus, Trash2, Users,
} from 'lucide-react'

const MODES = [
  { k: 'value', label: 'Só este(s)', icon: Tag,
    hint: 'Grava a categoria só nestes lançamentos (manual).' },
  { k: 'rule', label: 'Editar + criar regra', icon: Sparkles,
    hint: 'Cria uma regra e aplica retroativo a tudo que casa.' },
  { k: 'split', label: 'Dividir', icon: SplitSquareHorizontal, single: true,
    hint: 'Divide o lançamento: sua parte conta no fluxo; a parte adiantada '
      + 'vira Compartilhado (fora do fluxo) e anula com o reembolso.' },
  { k: 'queue', label: 'Mandar pro Claude', icon: MessageSquare,
    hint: 'Envia pra fila com uma nota; eu decido na conversa.' },
]
const FIELDS = [
  ['merchant_name', 'Lojista'],
  ['counterparty', 'Contraparte'],
  ['description', 'Descrição'],
]
const MATCHES = [
  ['contains', 'contém'], ['exact', 'igual a'],
  ['startswith', 'começa com'], ['regex', 'regex'],
]

export function EditModal({ open, onClose, txns, taxonomy, allTxns, onSaved }) {
  const t = useToast()
  const first = txns[0] || {}
  const [mode, setMode] = useState('value')
  const [cat, setCat] = useState(first.category || '')
  const [sub, setSub] = useState(first.subcategory || '')
  const [field, setField] = useState('merchant_name')
  const [match, setMatch] = useState('contains')
  const [value, setValue] = useState('')
  const [byType, setByType] = useState(false)
  const [note, setNote] = useState(
    () => (txns.length === 1 ? txns[0]?.note : '') || '')
  const [saving, setSaving] = useState(false)

  const single = txns.length === 1
  const absTotal = Math.abs(first.signed_amount || 0)
  const sign = (first.signed_amount || 0) < 0 ? -1 : 1
  const existingSplits = single && Array.isArray(first.splits) ? first.splits : null
  const [rows, setRows] = useState(() => existingSplits
    ? existingSplits.map((s) => ({ amt: String(Math.abs(s.amount)),
        category: s.category || '', subcategory: s.subcategory || '',
        note: s.note || '' }))
    : [{ amt: String(absTotal), category: first.category || '',
        subcategory: first.subcategory || '', note: '' }])

  const cats = Object.keys(taxonomy || {})
  const subs = taxonomy?.[cat] || []

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
    { amt: '', category: 'Compartilhado', subcategory: 'Outro',
      note: 'parte adiantada p/ outra pessoa' },
  ])

  // valor sugerido para a regra a partir do campo escolhido
  const suggested = useMemo(() => {
    const v = first[field]
    return v || first.description || ''
  }, [field, first])
  const ruleValue = value || suggested

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
      const f = norm(x[field])
      if (match === 'contains') return f.includes(tgt)
      if (match === 'exact') return f === tgt
      if (match === 'startswith') return f.startsWith(tgt)
      if (match === 'regex') return re && re.test(x[field] || '')
      return false
    }).length
  }, [mode, ruleValue, match, field, byType, allTxns, first])

  const ids = txns.map((x) => x.id)
  const canSave = mode === 'queue'
    ? note.trim().length > 0 || !!cat
    : mode === 'split'
      ? splitOk
      : !!cat && (mode !== 'rule' || !!ruleValue)

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
      if (mode === 'rule') {
        payload.rule = {
          field, match, value: ruleValue,
          ...(byType ? { type: first.type } : {}),
        }
      }
      if (mode === 'split') {
        payload.category = null
        payload.splits = rows.map((r) => ({
          amount: sign * Math.abs(parseFloat(r.amt) || 0),
          category: r.category, subcategory: r.subcategory || null,
          note: r.note || '',
        }))
      }
      const r = await postEdit(payload)
      if (mode === 'queue') {
        t(`${ids.length} lançamento(s) na Fila do Claude.\n` +
          'Veja/edite em "Fila do Claude" (topo) ou na aba Revisar.', 'success', 6000)
      } else if (mode === 'split') {
        t(`Lançamento dividido em ${rows.length} partes.`, 'success')
      } else {
        t(`Aplicado a ${ids.length} lançamento(s)` +
          (mode === 'rule' ? ' + regra aprendida.' : '.'), 'success')
      }
      onSaved(mode !== 'queue')
      onClose()
    } catch (e) {
      t('Erro ao salvar: ' + e.message, 'error', 7000)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal open={open} onOpenChange={(o) => !o && onClose()}
      width="max-w-xl"
      title={txns.length > 1
        ? `Editar ${txns.length} lançamentos` : 'Editar lançamento'}
      sub={txns.length === 1
        ? `${first.description} · ${signedBrl(first.signed_amount)}`
        : `${signedBrl(txns.reduce((a, x) => a + x.signed_amount, 0))} no total`}
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
      <div className="grid grid-cols-2 gap-2">
        {MODES.filter((m) => !m.single || single).map((m) => {
          const I = m.icon
          return (
            <button key={m.k} onClick={() => setMode(m.k)}
              className={`rounded-xl border px-3 py-2.5 text-left transition
                ${mode === m.k
                  ? 'border-green/50 bg-green/10'
                  : 'border-border bg-surface2 hover:border-faint'}`}>
              <I className={`size-4 ${mode === m.k ? 'text-green' : 'text-muted'}`} />
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
              <span className="truncate">{dayMonth(x.date)} · {x.description}</span>
              <span className="tnum">{signedBrl(x.signed_amount)}</span>
            </div>
          ))}
          {txns.length > 8 && <div className="px-1 pt-1">
            +{txns.length - 8} outros…</div>}
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
                <input value={r.note}
                  onChange={(e) => setRow(i, 'note', e.target.value)}
                  placeholder="nota (opcional)"
                  className={inputCls('mt-2 w-full')} />
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
          <p className="mt-2 text-[12px] text-muted">
            Dica: ponha sua parte na categoria real e a parte adiantada em
            <b className="text-text"> Compartilhado/Outro</b> — ela some do
            fluxo e anula quando o reembolso entrar (categorize o PIX recebido
            também como Compartilhado).
          </p>
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
          <label className="mt-2 flex items-center gap-2 text-[12px] text-muted">
            <input type="checkbox" checked={byType}
              onChange={(e) => setByType(e.target.checked)} />
            só quando o tipo for {first.type} (evita casar entrada com saída)
          </label>
          {preview != null && (
            <p className="mt-2 text-[12px] text-blue">
              ≈ {preview} lançamento(s) deste mês casam — a aplicação é
              retroativa em todo o histórico.
            </p>
          )}
        </div>
      )}

      {/* nota da transação (contexto p/ o Claude; aparece no hover) */}
      {mode !== 'queue' && (
        <label className="mt-4 block text-[12px] text-muted">
          Nota {txns.length > 1 ? '(aplicada a todos)' : ''} — contexto,
          aparece no hover e fica registrada pro Claude
          <textarea value={note} onChange={(e) => setNote(e.target.value)}
            rows={3}
            placeholder="Ex.: dividi a conta com um amigo; jantar de aniversário…"
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
    </Modal>
  )
}
