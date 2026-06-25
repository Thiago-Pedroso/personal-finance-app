import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import fs from 'node:fs'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DATA = path.join(ROOT, 'data')
const REPORTS_DIR = path.join(DATA, 'reports')
const DECISIONS = path.join(DATA, '.decisions.json')
const QUEUE = path.join(DATA, '.claude_queue.jsonl')
const BUDGETS = path.join(DATA, 'budgets.json')
const BAK = path.join(DATA, '.bak')

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

function backup(targets = ['ledger.jsonl', 'rules.json']) {
  fs.mkdirSync(BAK, { recursive: true })
  const ts = new Date().toISOString().replace(/[:.]/g, '-')
  for (const f of targets) {
    const src = path.join(DATA, f)
    if (fs.existsSync(src)) fs.copyFileSync(src, path.join(BAK, `${f}.${ts}`))
  }
  // mantém só os 12 backups mais recentes de cada arquivo
  const files = fs.readdirSync(BAK)
  for (const base of targets) {
    const mine = files.filter((x) => x.startsWith(base + '.')).sort()
    for (const old of mine.slice(0, -12)) fs.unlinkSync(path.join(BAK, old))
  }
}

async function applyBudget(b) {
  backup(['budgets.json'])
  fs.writeFileSync(BUDGETS, JSON.stringify(b, null, 2) + '\n')
  const r = await run('uv', ['run', 'python', '-m', 'finance.report'])
  return { ok: r.ok, step: r.ok ? 'done' : 'report',
    log: r.stdout.trim(), stderr: r.stderr.trim() }
}

// edições são serializadas para nunca correr o risco de corromper o ledger
let lock = Promise.resolve()
const serialize = (fn) => (lock = lock.then(fn, fn))

async function applyEdit(p) {
  // p = { mode, ids[], category, subcategory, rule?{field,match,value,type}, note? }
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

  backup()
  const learn = p.mode === 'rule'
  const decisions = { assignments: [], rules: [] }
  const noteVal = p.note == null ? '' : String(p.note)
  if (p.mode === 'split' && Array.isArray(p.splits) && p.splits.length) {
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
      note: `dashboard ${new Date().toISOString().slice(0, 10)}`,
      ...(p.rule.type ? { type: p.rule.type } : {}),
    })
  }
  fs.writeFileSync(DECISIONS, JSON.stringify(decisions, null, 2) + '\n')

  const args = ['run', 'python', '-m', 'finance.categorize', 'apply']
  if (learn) args.push('--learn')
  const a = await run('uv', args)
  if (!a.ok) return { ok: false, step: 'categorize', ...a }
  const r = await run('uv', ['run', 'python', '-m', 'finance.report'])
  return { ok: r.ok, step: r.ok ? 'done' : 'report',
    log: (a.stdout + r.stdout).trim(), stderr: (a.stderr + r.stderr).trim() }
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
