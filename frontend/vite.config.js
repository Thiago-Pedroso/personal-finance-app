import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import fs from 'node:fs'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { fileURLToPath } from 'node:url'

// Fonte da verdade dos dados = Google Sheets (via pipeline Python). Aqui o middleware só
// lê os relatórios gerados localmente e delega escritas ao Python, que fala com o Sheets.
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DATA = path.join(ROOT, 'data')
const REPORTS_DIR = path.join(DATA, 'reports')
const DECISIONS = path.join(DATA, '.decisions.json')
const EDITS = path.join(DATA, '.edits.json')
const QUEUE = path.join(DATA, '.claude_queue.jsonl')
const BUDGET_INPUT = path.join(DATA, '.budget_input.json')
const INVEST_DECISIONS = path.join(DATA, '.invest_decisions.json')
const INVEST_PENDING = path.join(DATA, '.invest_pending.json')

function readBody(req) {
  return new Promise((resolve, reject) => {
    let b = ''
    req.on('data', (c) => (b += c))
    req.on('end', () => {
      try { resolve(b ? JSON.parse(b) : {}) } catch (e) { reject(e) }
    })
    req.on('error', reject)
  })
}
const json = (res, code, obj) => {
  res.statusCode = code
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  res.end(JSON.stringify(obj))
}

function run(cmd, args) {
  return new Promise((resolve) => {
    execFile(cmd, args, { cwd: ROOT, env: process.env, maxBuffer: 1 << 24 },
      (err, stdout, stderr) => resolve({
        ok: !err, code: err ? err.code ?? 1 : 0,
        stdout: String(stdout || ''), stderr: String(stderr || ''),
      }))
  })
}

// Sem backup local: os dados vivem no Google Sheets, que já mantém histórico de versões
// nativo (Arquivo → Histórico de versões). Reverter = restaurar uma versão da planilha.

async function applyBudget(b) {
  // grava o orçamento num arquivo temp e deixa o Python salvar no Sheets + regerar relatórios
  fs.writeFileSync(BUDGET_INPUT, JSON.stringify(b, null, 2) + '\n')
  const r = await run('uv', ['run', 'python', '-m', 'finance.budgets', 'set', BUDGET_INPUT])
  return { ok: r.ok, step: r.ok ? 'done' : 'budget',
    log: r.stdout.trim(), stderr: r.stderr.trim() }
}

// Investimentos: tudo passa pelo mesmo arquivo de decisões do caminho por conversa,
// então a tela não tem validação própria nem um segundo jeito de gravar.
async function applyInvest(payload) {
  fs.writeFileSync(INVEST_DECISIONS, JSON.stringify(payload, null, 2) + '\n')
  const r = await run('uv', ['run', 'python', '-m', 'finance.invest', 'apply'])
  return { ok: r.ok, step: r.ok ? 'done' : 'invest',
    log: r.stdout.trim(), stderr: r.stderr.trim() }
}

// edições são serializadas para nunca correr o risco de corromper o ledger
let lock = Promise.resolve()
const serialize = (fn) => (lock = lock.then(fn, fn))

// O relatório existe só para o disco estar certo no próximo F5 — ninguém espera por
// ele. Roda fora do caminho da resposta e agrupado por uma janela de silêncio, para
// 10 edições seguidas não dispararem 10 regerações.
let reportTimer = null
function scheduleReport() {
  if (reportTimer) clearTimeout(reportTimer)
  reportTimer = setTimeout(() => {
    reportTimer = null
    serialize(() => run('uv', ['run', 'python', '-m', 'finance.report']))
  }, 1500)
}

// Edição de linha: grava só as células que mudaram. Não lê a aba inteira, não
// carrega regras e não gera relatório. Criar regra continua no caminho pesado,
// porque uma regra afeta lançamentos além do que está sendo editado.
async function applyRowEdit(p) {
  const fields = {}
  if (p.mode === 'tags') {
    if (p.tags_add?.length) fields.tags_add = p.tags_add
    if (p.tags_remove?.length) fields.tags_remove = p.tags_remove
  } else if (p.mode === 'split' && Array.isArray(p.splits) && p.splits.length) {
    fields.splits = p.splits.map((s) => ({
      amount: Number(s.amount), category: s.category,
      subcategory: s.subcategory || null, note: s.note || '',
    }))
    if (p.note != null) fields.note = String(p.note)
  } else {
    if (p.category) {
      fields.category = p.category
      fields.subcategory = p.subcategory || null
    }
    if (p.note != null) fields.note = String(p.note)
  }
  if (p.excluded !== undefined) fields.excluded = !!p.excluded
  if (!Object.keys(fields).length)
    return { ok: false, step: 'edit', stderr: 'nada para gravar' }

  fs.writeFileSync(EDITS,
    JSON.stringify({ edits: [{ ids: p.ids, fields }] }, null, 2) + '\n')
  const r = await run('uv', ['run', 'python', '-m', 'finance.edit', EDITS])
  return { ok: r.ok, step: r.ok ? 'done' : 'edit',
    log: r.stdout.trim(), stderr: r.stderr.trim() }
}

async function applyEdit(p) {
  // p = { mode, ids[], category, subcategory, tags_add[], tags_remove[] }
  if (p.mode === 'queue') {
    const line = JSON.stringify({
      ts: new Date().toISOString(),
      ids: p.ids, note: p.note || '',
      suggestion: p.category
        ? { category: p.category, subcategory: p.subcategory || null } : null,
      samples: p.samples || [],
    })
    fs.appendFileSync(QUEUE, line + '\n')
    return { ok: true, mode: 'queue', queued: p.ids.length }
  }

  if (p.mode !== 'rule') {
    const r = await applyRowEdit(p)
    if (r.ok) scheduleReport()
    return r
  }

  const learn = p.mode === 'rule'
  const decisions = { assignments: [], rules: [] }
  const propagate = learn && !!p.rule?.propagate_note && !!p.rule?.note
  const noteVal = propagate ? String(p.rule.note)
    : p.note == null ? '' : String(p.note)
  if (p.mode === 'tags') {
    decisions.assignments.push({
      ids: p.ids,
      tags_add: Array.isArray(p.tags_add) ? p.tags_add : [],
      tags_remove: Array.isArray(p.tags_remove) ? p.tags_remove : [],
    })
  } else if (p.mode === 'split' && Array.isArray(p.splits) && p.splits.length) {
    decisions.assignments.push({
      ids: p.ids,
      note: noteVal,
      splits: p.splits.map((s) => ({
        amount: Number(s.amount),
        category: s.category,
        subcategory: s.subcategory || null,
        note: s.note || '',
      })),
    })
  } else if (p.category) {
    decisions.assignments.push({
      ids: p.ids, category: p.category,
      subcategory: p.subcategory || null, source: 'manual',
      note: noteVal,
    })
  }
  if (learn && p.rule && p.rule.value) {
    decisions.rules.push({
      field: p.rule.field, match: p.rule.match || 'contains',
      value: p.rule.value, category: p.category,
      subcategory: p.subcategory || null,
      note: propagate ? String(p.rule.note) : '',
      ...(propagate ? { propagate_note: true } : {}),
      ...(p.rule.instruction ? { instruction: String(p.rule.instruction) } : {}),
      ...(p.rule.type ? { type: p.rule.type } : {}),
      ...(p.rule.amount_abs_min != null ? { amount_abs_min: Number(p.rule.amount_abs_min) } : {}),
      ...(p.rule.amount_abs_max != null ? { amount_abs_max: Number(p.rule.amount_abs_max) } : {}),
      ...(p.excluded ? { excluded: true } : {}),
    })
  }
  // "rasurar": tira o lançamento dos agregados (reversível). Pode vir sozinho
  // ou junto de uma recategorização. Não mexe na nota se não veio nota.
  if (p.excluded !== undefined) {
    const val = !!p.excluded
    if (decisions.assignments.length) {
      for (const a of decisions.assignments) a.excluded = val
    } else {
      const ex = { ids: p.ids, excluded: val }
      if (p.note != null && p.note !== '') ex.note = String(p.note)
      decisions.assignments.push(ex)
    }
  }
  fs.writeFileSync(DECISIONS, JSON.stringify(decisions, null, 2) + '\n')

  // relatório adiado: a tela só relê depois que a fila de saída esvazia
  const args = ['run', 'python', '-m', 'finance.categorize', 'apply']
  if (learn) args.push('--learn')
  const a = await run('uv', args)
  if (a.ok) scheduleReport()
  return { ok: a.ok, step: a.ok ? 'done' : 'categorize',
    log: a.stdout.trim(), stderr: a.stderr.trim() }
}

function financeServer() {
  return {
    name: 'finance-server',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = (req.url || '').split('?')[0]

        // ---- leitura ao vivo dos relatórios
        if (url.startsWith('/data/')) {
          const rel = decodeURIComponent(url.slice('/data/'.length))
          if (!rel || rel.includes('..') || path.isAbsolute(rel))
            return json(res, 400, { error: 'caminho inválido' })
          return fs.readFile(path.join(REPORTS_DIR, rel), (e, buf) => {
            if (e) return json(res, 404, {
              error: 'relatório não encontrado — rode finance.report' })
            res.setHeader('Content-Type', 'application/json; charset=utf-8')
            res.setHeader('Cache-Control', 'no-store')
            res.end(buf)
          })
        }

        // ---- fila para o Claude
        if (url === '/api/queue' && req.method === 'GET') {
          let items = []
          if (fs.existsSync(QUEUE)) {
            items = fs.readFileSync(QUEUE, 'utf8').split('\n')
              .filter(Boolean)
              .map((l, i) => { try { return { i, ...JSON.parse(l) } }
                catch { return null } }).filter(Boolean)
          }
          return json(res, 200, { items })
        }
        if (url === '/api/queue/remove' && req.method === 'POST') {
          const { index } = await readBody(req).catch(() => ({}))
          if (fs.existsSync(QUEUE)) {
            const lines = fs.readFileSync(QUEUE, 'utf8').split('\n').filter(Boolean)
            lines.splice(index, 1)
            fs.writeFileSync(QUEUE, lines.length ? lines.join('\n') + '\n' : '')
          }
          return json(res, 200, { ok: true })
        }
        if (url === '/api/queue/update' && req.method === 'POST') {
          const { index, note, suggestion } =
            await readBody(req).catch(() => ({}))
          if (fs.existsSync(QUEUE)) {
            const lines = fs.readFileSync(QUEUE, 'utf8').split('\n').filter(Boolean)
            if (index >= 0 && index < lines.length) {
              let it
              try { it = JSON.parse(lines[index]) } catch { it = null }
              if (it) {
                if (note !== undefined) it.note = note
                if (suggestion !== undefined) it.suggestion = suggestion
                it.edited_at = new Date().toISOString()
                lines[index] = JSON.stringify(it)
                fs.writeFileSync(QUEUE, lines.join('\n') + '\n')
              }
            }
          }
          return json(res, 200, { ok: true })
        }

        // ---- edição (serializada)
        if (url === '/api/edit' && req.method === 'POST') {
          let payload
          try { payload = await readBody(req) }
          catch { return json(res, 400, { ok: false, error: 'JSON inválido' }) }
          if (!payload.ids || !payload.ids.length)
            return json(res, 400, { ok: false, error: 'sem ids' })
          try {
            const result = await serialize(() => applyEdit(payload))
            return json(res, result.ok ? 200 : 500, result)
          } catch (e) {
            return json(res, 500, { ok: false, error: String(e) })
          }
        }

        // ---- investimentos
        if (url === '/api/invest/apply' && req.method === 'POST') {
          let payload
          try { payload = await readBody(req) }
          catch { return json(res, 400, { ok: false, error: 'JSON inválido' }) }
          try {
            const result = await serialize(() => applyInvest(payload))
            return json(res, result.ok ? 200 : 500, result)
          } catch (e) {
            return json(res, 500, { ok: false, error: String(e) })
          }
        }
        if (url === '/api/invest/refresh' && req.method === 'POST') {
          const result = await serialize(() =>
            run('uv', ['run', 'python', '-m', 'finance.invest', 'report']))
          return json(res, result.ok ? 200 : 500,
            { ok: result.ok, log: result.stdout.trim(), stderr: result.stderr.trim() })
        }
        if (url === '/api/invest/sync' && req.method === 'POST') {
          const body = await readBody(req).catch(() => ({}))
          const args = ['run', 'python', '-m', 'finance.invest', 'sync']
          if (body.applyBalances) args.push('--apply-balances')
          if (body.applyIncome) args.push('--apply-income')
          const result = await serialize(() => run('uv', args))
          return json(res, result.ok ? 200 : 500,
            { ok: result.ok, log: result.stdout.trim(), stderr: result.stderr.trim() })
        }
        if (url === '/api/invest/pending' && req.method === 'GET') {
          if (!fs.existsSync(INVEST_PENDING)) return json(res, 200, { pending: [] })
          try {
            return json(res, 200, JSON.parse(fs.readFileSync(INVEST_PENDING, 'utf8')))
          } catch { return json(res, 200, { pending: [] }) }
        }

        // ---- planejamento: grava budgets.json + recalcula (serializado)
        if (url === '/api/budget' && req.method === 'POST') {
          let b
          try { b = await readBody(req) }
          catch { return json(res, 400, { ok: false, error: 'JSON inválido' }) }
          if (!b || typeof b !== 'object' || !b.spending)
            return json(res, 400, { ok: false, error: 'payload inválido' })
          try {
            const result = await serialize(() => applyBudget(b))
            return json(res, result.ok ? 200 : 500, result)
          } catch (e) {
            return json(res, 500, { ok: false, error: String(e) })
          }
        }
        next()
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), tailwindcss(), financeServer()],
  server: { port: 5273, open: true },
})
