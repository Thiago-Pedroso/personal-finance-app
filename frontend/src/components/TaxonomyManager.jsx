import { useMemo, useState } from 'react'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import { Modal } from './ui/Modal.jsx'
import { Badge, Button, Spinner } from './ui/primitives.jsx'
import { inputCls } from './ui/MultiSelect.jsx'
import { applyTaxonomy, previewTaxonomy } from '../lib/api.js'
import { buildOperation, canConfirm, impactText, isDestructive, taxonomyRows } from '../lib/taxonomyManager.js'

const blank = { kind: 'create-category', category: '', subcategory: '', newCategory: '', newSubcategory: '', treatment: 'fluxo' }
const labels = { 'create-category': 'Criar categoria', 'create-subcategory': 'Criar subcategoria',
  'rename-category': 'Renomear categoria', 'rename-subcategory': 'Renomear subcategoria',
  'delete-category': 'Remover categoria', 'delete-subcategory': 'Remover subcategoria' }

export function TaxonomyManager({ open, onClose, taxonomy, treatments, onSaved, toast }) {
  const rows = useMemo(() => taxonomyRows(taxonomy, treatments), [taxonomy, treatments])
  const [form, setForm] = useState(blank); const [preview, setPreview] = useState(null)
  const [acknowledged, setAcknowledged] = useState(false); const [busy, setBusy] = useState(false); const [error, setError] = useState('')
  const set = (patch) => { setForm((old) => ({ ...old, ...patch })); setPreview(null); setAcknowledged(false); setError('') }
  const operation = buildOperation(form.kind, form)
  const reset = () => { setForm(blank); setPreview(null); setAcknowledged(false); setError('') }
  const close = () => { if (!busy) { reset(); onClose() } }
  const choose = (kind, values = {}) => set({ ...blank, kind, ...values })
  const getPreview = async () => {
    if (!operation) return setError('Preencha um nome válido (sem vírgula) e o tratamento ao criar.')
    setBusy(true); setError(''); setPreview(null); setAcknowledged(false)
    try { setPreview(await previewTaxonomy(operation)) }
    catch (e) { setError(e.message) } finally { setBusy(false) }
  }
  const confirm = async () => {
    if (!canConfirm(operation, preview, acknowledged)) return
    setBusy(true); setError('')
    try {
      const result = await applyTaxonomy({ operation, fingerprint: preview.fingerprint })
      await onSaved(); toast(`${labels[operation.kind]}: ${impactText(result.impact)}`, 'success')
      reset(); onClose()
    } catch (e) {
      if (e.persisted) {
        await onSaved()
        const recovery = e.step === 'taxonomy-migration'
          ? 'A migração pode ter sido parcial. Não repita o rename: recupere pelo Histórico de versões do Sheets.'
          : 'A taxonomia foi gravada; regenere os relatórios. Não repita a mutação.'
        toast(recovery, 'error')
        setPreview(null); setAcknowledged(false)
      } else if (/prévia venceu/i.test(e.message)) { setPreview(null); setAcknowledged(false) }
      setError(e.message)
    } finally { setBusy(false) }
  }
  const input = (key, placeholder) => <input value={form[key]} placeholder={placeholder}
    onChange={(e) => set({ [key]: e.target.value })} className={inputCls('w-full')} />
  const confirmReady = canConfirm(operation, preview, acknowledged)

  return <Modal open={open} onOpenChange={(next) => !next && close()} width="max-w-4xl"
    title="Gerenciar taxonomia" sub="Altera a planilha somente depois da prévia e confirmação.">
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1.1fr_.9fr]">
      <section><h3 className="text-sm font-semibold">Categorias atuais</h3>
        <div className="mt-3 space-y-2">{rows.map((row) => <div key={row.category} className="rounded-xl border border-border p-3">
          <div className="flex flex-wrap items-center justify-between gap-2"><div className="font-medium">{row.category} <Badge tone={row.treatment === 'fluxo' ? 'green' : row.treatment === 'poupança' ? 'blue' : 'amber'}>{row.treatment}</Badge></div>
            <div className="flex gap-1"><Button type="button" variant="ghost" title="Renomear categoria" onClick={() => choose('rename-category', { category: row.category, newCategory: row.category })}><Pencil className="size-3.5" /></Button><Button type="button" variant="danger" title="Remover categoria" onClick={() => choose('delete-category', { category: row.category })}><Trash2 className="size-3.5" /></Button></div></div>
          {row.subcategories.length ? <div className="mt-2 flex flex-wrap gap-1.5">{row.subcategories.map((sub) => <span key={sub} className="inline-flex items-center gap-1 rounded-lg bg-surface2 px-2 py-1 text-xs">{sub}<button type="button" title="Renomear subcategoria" onClick={() => choose('rename-subcategory', { category: row.category, subcategory: sub, newSubcategory: sub })}><Pencil className="size-3" /></button><button type="button" title="Remover subcategoria" className="text-red" onClick={() => choose('delete-subcategory', { category: row.category, subcategory: sub })}><Trash2 className="size-3" /></button></span>)}</div> : <p className="mt-2 text-xs text-faint">Sem subcategorias.</p>}
          <button type="button" onClick={() => choose('create-subcategory', { category: row.category })} className="mt-2 text-xs text-brand hover:underline">+ Subcategoria</button>
        </div>)}</div>
      </section>
      <section className="rounded-xl border border-border bg-surface2/40 p-4"><div className="flex items-center justify-between"><h3 className="text-sm font-semibold">{labels[form.kind]}</h3><Button type="button" variant="ghost" onClick={() => choose('create-category')}><Plus className="size-3.5" /> Categoria</Button></div>
        <div className="mt-4 space-y-3 text-sm">
          {form.kind !== 'create-category' && <label className="block">Categoria{input('category', 'Categoria')}</label>}
          {form.kind === 'create-category' && <><label className="block">Nome{input('category', 'Nova categoria')}</label><label className="block">Tratamento<select value={form.treatment} onChange={(e) => set({ treatment: e.target.value })} className={inputCls('w-full')}><option value="fluxo">fluxo</option><option value="poupança">poupança</option><option value="movimento">movimento</option></select></label></>}
          {(form.kind === 'create-subcategory' || form.kind === 'delete-subcategory' || form.kind === 'rename-subcategory') && <label className="block">Subcategoria{input('subcategory', 'Subcategoria')}</label>}
          {form.kind === 'rename-category' && <label className="block">Novo nome{input('newCategory', 'Novo nome')}</label>}
          {form.kind === 'rename-subcategory' && <label className="block">Novo nome{input('newSubcategory', 'Novo nome')}</label>}
          {isDestructive(operation) && <p className="rounded-lg border border-red/35 bg-red/10 p-2 text-xs text-red">Lançamentos simples serão descategorizados e revisados; regras vinculadas serão removidas; partes de split irão para Outros / A revisar.</p>}
          <Button type="button" onClick={getPreview} disabled={busy || !operation}>{busy && <Spinner />} Ver impacto</Button>
          {preview && <div className="rounded-lg border border-brand/30 bg-brand/10 p-3 text-xs"><b>Impacto:</b> {impactText(preview.impact)}<p className="mt-1">{isDestructive(operation) ? 'A remoção preserva valores e soma dos splits.' : 'Referências históricas serão migradas sem mudar valores.'}</p></div>}
          {preview && <label className="flex items-start gap-2 text-xs"><input type="checkbox" checked={acknowledged} onChange={(e) => setAcknowledged(e.target.checked)} /> <span>Entendo o impacto e confirmo esta alteração.</span></label>}
          {error && <p className="text-xs text-red">{error}</p>}
          <div className="flex gap-2"><Button type="button" variant={isDestructive(operation) ? 'danger' : 'primary'} disabled={busy || !confirmReady} onClick={confirm}>{busy && <Spinner />} Confirmar alteração</Button><Button type="button" variant="ghost" disabled={busy} onClick={reset}>Cancelar intenção</Button></div>
        </div>
      </section>
    </div>
  </Modal>
}
