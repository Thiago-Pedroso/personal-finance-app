#!/usr/bin/env node
// Checagem estática do frontend, no espírito do eslint `no-undef` + `react/jsx-no-undef`,
// sem adicionar dependência: usa o @babel/parser/@babel/traverse que já vêm com o
// @vitejs/plugin-react. Pega o tipo de erro que o build do Vite não acusa:
//   1. identificador usado sem import/declaração (componente JSX, função, ícone);
//   2. módulo em src/ que ninguém importa a partir do main.jsx (código órfão).
//   3. import nomeado que o módulo de destino não exporta mais.
// Uso: node scripts/check-undefined.mjs   (sai com código 1 se achar problema)
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
let parse, traverse, bindingIds
try {
  ;({ parse } = require('@babel/parser'))
  bindingIds = require('@babel/types').getBindingIdentifiers
  const t = require('@babel/traverse')
  traverse = t.default || t
} catch {
  console.error('check-undefined: @babel/parser/@babel/traverse não encontrados '
    + '(rode npm install no frontend).')
  process.exit(2)
}

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SRC = join(ROOT, 'src')
// raízes do grafo: o app e o servidor de dev (vite.config.js importa de src/lib)
const ENTRIES = [join(SRC, 'main.jsx'), join(ROOT, 'vite.config.js')]

// Módulos que podem ficar fora do grafo de imports, com o motivo. Esvazie ao religar.
const ORPHAN_ALLOW = new Map([
])

// Globais do navegador/JS usados no código. Builtins do próprio Node (Math, Date,
// Intl, URL, fetch, setTimeout...) vêm de globalThis.
const BROWSER_GLOBALS = new Set([
  'window', 'document', 'navigator', 'location', 'localStorage', 'sessionStorage',
  'history', 'getComputedStyle', 'matchMedia', 'requestAnimationFrame',
  'cancelAnimationFrame', 'requestIdleCallback', 'cancelIdleCallback', 'alert',
  'confirm', 'prompt', 'HTMLElement', 'Element', 'Node', 'KeyboardEvent', 'MouseEvent',
  'ResizeObserver', 'IntersectionObserver', 'MutationObserver', 'FileReader', 'Image',
  'innerWidth', 'innerHeight', 'scrollX', 'scrollY', 'devicePixelRatio', 'screen',
  'getSelection', 'CSS', 'DOMParser', 'XMLHttpRequest', 'Notification', 'open',
  'import',
])
const isGlobal = (name) => name in globalThis || BROWSER_GLOBALS.has(name)

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) return walk(full)
    return /\.(jsx?|mjs)$/.test(name) && !/\.test\.js$/.test(name) ? [full] : []
  })
}

function resolveImport(from, spec) {
  if (!spec.startsWith('.')) return null
  const base = resolve(dirname(from), spec)
  for (const cand of [base, `${base}.js`, `${base}.jsx`, join(base, 'index.js'),
    join(base, 'index.jsx')]) {
    if (existsSync(cand) && statSync(cand).isFile()) return cand
  }
  return undefined
}

const problems = []
const graph = new Map()
const exportsOf = new Map()   // arquivo -> { names: Set, star: [arquivo], hasDefault }
const imports = []            // { rel, line, target, name }

for (const file of [...walk(SRC), join(ROOT, 'vite.config.js')]) {
  const code = readFileSync(file, 'utf8')
  const rel = relative(ROOT, file)
  let ast
  try {
    ast = parse(code, { sourceType: 'module', plugins: ['jsx'] })
  } catch (e) {
    problems.push(`${rel}: não compila (${e.message})`)
    continue
  }
  const deps = []
  const ex = { names: new Set(), star: [], hasDefault: false }
  exportsOf.set(file, ex)
  traverse(ast, {
    'ImportDeclaration|ExportNamedDeclaration|ExportAllDeclaration'(path) {
      const { node } = path
      if (path.isExportNamedDeclaration()) {
        const decl = node.declaration
        if (decl?.id) ex.names.add(decl.id.name)
        for (const d of decl?.declarations || []) {
          for (const n of Object.keys(bindingIds(d.id))) ex.names.add(n)
        }
        for (const sp of node.specifiers || []) ex.names.add(sp.exported.name ?? sp.exported.value)
      }
      const spec = node.source?.value
      if (!spec) return
      const target = resolveImport(file, spec)
      if (target === undefined) { problems.push(`${rel}: import inexistente '${spec}'`); return }
      if (!target) return
      deps.push(target)
      if (path.isExportAllDeclaration()) ex.star.push(target)
      for (const sp of node.specifiers || []) {
        if (sp.type === 'ImportSpecifier') {
          imports.push({ rel, line: sp.loc?.start.line, target,
            name: sp.imported.name ?? sp.imported.value })
        } else if (sp.type === 'ImportDefaultSpecifier') {
          imports.push({ rel, line: sp.loc?.start.line, target, name: 'default' })
        } else if (sp.type === 'ExportSpecifier' && path.isExportNamedDeclaration()) {
          imports.push({ rel, line: sp.loc?.start.line, target, name: sp.local.name })
        }
      }
    },
    ExportDefaultDeclaration() { ex.hasDefault = true },
    ReferencedIdentifier(path) {
      const { name } = path.node
      if (path.isJSXIdentifier()) {
        // <div>, <span>: tag HTML; <Comp> e <Comp.Item>: precisam existir no escopo
        if (!/^[A-Z]/.test(name)) return
        if (path.parentPath.isJSXMemberExpression()
          && path.parentPath.node.property === path.node) return
      }
      if (path.scope.hasBinding(name, true) || isGlobal(name)) return
      // `typeof x` é o jeito legítimo de testar se algo existe
      if (path.parentPath.isUnaryExpression({ operator: 'typeof' })) return
      const line = path.node.loc?.start.line
      problems.push(`${rel}:${line}: '${name}' não está definido nem importado`)
    },
  })
  graph.set(file, deps)
}

// import nomeado precisa existir no módulo de destino (pega `import { x }` de algo removido)
function exportsName(file, name, guard = new Set()) {
  const ex = exportsOf.get(file)
  if (!ex || guard.has(file)) return true   // fora de src/: não dá para conferir
  guard.add(file)
  if (name === 'default') return ex.hasDefault || ex.names.has('default')
  return ex.names.has(name) || ex.star.some((f) => exportsName(f, name, guard))
}
for (const imp of imports) {
  if (!exportsName(imp.target, imp.name)) {
    problems.push(`${imp.rel}:${imp.line}: '${imp.name}' não é exportado por `
      + `${relative(ROOT, imp.target)}`)
  }
}

// alcançáveis a partir do main.jsx e do vite.config.js
const seen = new Set()
const stack = [...ENTRIES]
while (stack.length) {
  const f = stack.pop()
  if (seen.has(f)) continue
  seen.add(f)
  stack.push(...(graph.get(f) || []))
}
for (const file of graph.keys()) {
  const rel = relative(SRC, file)
  if (ENTRIES.includes(file)) continue
  if (!seen.has(file) && !ORPHAN_ALLOW.has(rel)) {
    problems.push(`src/${rel}: módulo órfão (ninguém importa a partir do main.jsx)`)
  }
}

if (problems.length) {
  console.error(`check-undefined: ${problems.length} problema(s)`)
  for (const p of [...new Set(problems)]) console.error(`  - ${p}`)
  process.exit(1)
}
console.log(`check-undefined: ok (${graph.size} módulos, ${seen.size} alcançáveis)`)
