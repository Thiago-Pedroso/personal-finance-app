import { useState } from 'react'
import { Card, CardHead, Button, Badge } from './ui/primitives.jsx'
import { inputCls } from './ui/MultiSelect.jsx'
import { TransactionsTable } from './TransactionsTable.jsx'
import { signedBrl } from '../lib/format.js'
import { Trash2, MessageSquare, Pencil, Check, X } from 'lucide-react'

function Stat({ label, value, tone }) {
  return (
    <Card className="p-5">
      <div className="text-[12px] font-semibold uppercase tracking-wider
        text-muted">{label}</div>
      <div className={`mt-1.5 text-[28px] font-bold ${tone}`}>{value}</div>
    </Card>
  )
}

function QueueItem({ q, taxonomy, onUpdate, onRemove }) {
  const [edit, setEdit] = useState(false)
  const [note, setNote] = useState(q.note || '')
  const [cat, setCat] = useState(q.suggestion?.category || '')
  const [sub, setSub] = useState(q.suggestion?.subcategory || '')
  const [saving, setSaving] = useState(false)
  const subs = taxonomy?.[cat] || []

  async function save() {
    setSaving(true)
    await onUpdate(q.i, {
      note,
      suggestion: cat ? { category: cat, subcategory: sub || null } : null,
    })
    setSaving(false)
    setEdit(false)
  }

  return (
    <div className="rounded-xl border border-border bg-surface2/50 p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2 text-[12px] text-faint">
          <MessageSquare className="size-3.5 text-blue" />
          {new Date(q.ts).toLocaleString('pt-BR')} · {q.ids.length} lançamento(s)
          {q.edited_at && <span className="italic">· editado</span>}
          {q.suggestion && (
            <Badge tone="blue">{q.suggestion.category}
              {q.suggestion.subcategory
                ? ` / ${q.suggestion.subcategory}` : ''}</Badge>
          )}
        </div>
        {!edit && (
          <div className="flex shrink-0 gap-1">
            <Button variant="ghost" onClick={() => setEdit(true)}
              title="Editar item da fila"><Pencil className="size-4" /></Button>
            <Button variant="ghost" onClick={() => onRemove(q.i)}
              title="Remover da fila"><Trash2 className="size-4" /></Button>
          </div>
        )}
      </div>

      {q.samples?.length > 0 && (
        <div className="mt-2 flex flex-col gap-0.5 text-[12px] text-faint">
          {q.samples.map((s, k) => (
            <div key={k} className="flex justify-between gap-3">
              <span className="truncate">{s.date} · {s.description}</span>
              <span className="tnum">{signedBrl(s.signed_amount)}</span>
            </div>
          ))}
        </div>
      )}

      {!edit ? (
        q.note && <p className="mt-2 whitespace-pre-wrap text-[13px]">{q.note}</p>
      ) : (
        <div className="mt-3 flex flex-col gap-2">
          <textarea value={note} onChange={(e) => setNote(e.target.value)}
            rows={4} className={inputCls('w-full resize-y')}
            placeholder="Nota pro Claude…" />
          <div className="grid grid-cols-2 gap-2">
            <select value={cat}
              onChange={(e) => { setCat(e.target.value); setSub('') }}
              className={inputCls()}>
              <option value="">— categoria sugerida (opcional)</option>
              {Object.keys(taxonomy || {}).map((c) =>
                <option key={c} value={c}>{c}</option>)}
            </select>
            <select value={sub} onChange={(e) => setSub(e.target.value)}
              disabled={!subs.length} className={inputCls()}>
              <option value="">— subcategoria</option>
              {subs.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => {
              setEdit(false); setNote(q.note || '')
              setCat(q.suggestion?.category || '')
              setSub(q.suggestion?.subcategory || '')
            }}><X className="size-4" /> Cancelar</Button>
            <Button variant="primary" disabled={saving} onClick={save}>
              <Check className="size-4" /> {saving ? 'Salvando…' : 'Salvar'}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

export function Review({ dash, queue, queuedIds, onRemoveQueue,
  onUpdateQueue, openEdit }) {
  // todo o histórico que precisa de ação (não só o mês selecionado)
  const pend = dash.review || []
  const total = dash.pending ?? pend.length
  const semCat = total - (dash.needs_review || 0)

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 md:grid-cols-3">
        <Stat label="Anomalias (valor atípico)" value={dash.needs_review}
          tone={dash.needs_review ? 'text-amber' : 'text-green'} />
        <Stat label="Sem categoria / palpite Pluggy" value={semCat}
          tone={semCat ? 'text-amber' : 'text-green'} />
        <Stat label="Na fila do Claude" value={queue.length}
          tone={queue.length ? 'text-blue' : 'text-green'} />
      </div>

      <Card className="border-blue/25 bg-blue/[0.05] px-5 py-4 text-[13px]
        text-muted">
        A categorização passa pelo pipeline de regras. <b className="text-text">
        Editar + criar regra</b> aplica retroativo a tudo que casa;{' '}
        <b className="text-text">mandar pro Claude</b> guarda aqui pra eu tratar
        na conversa. Ou rode: <code className="rounded bg-white/10 px-1.5
        py-0.5 text-[12px] text-text">sincroniza, categoriza e atualiza</code>.
      </Card>

      {queue.length > 0 && (
        <Card>
          <CardHead title={`Fila do Claude (${queue.length})`}
            sub="enviados pelo dashboard — edite a nota/sugestão; eu trato na conversa" />
          <div className="flex flex-col gap-2 px-5 pb-5">
            {queue.map((q) => (
              <QueueItem key={q.i} q={q} taxonomy={dash.taxonomy}
                onUpdate={onUpdateQueue} onRemove={onRemoveQueue} />
            ))}
          </div>
        </Card>
      )}

      <TransactionsTable txns={pend} openEdit={openEdit} pageSize={50}
        queuedIds={queuedIds}
        title={`Pendências — todo o histórico (${pend.length})`} />
    </div>
  )
}
