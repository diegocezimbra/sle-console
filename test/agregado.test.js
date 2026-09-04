import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  indexarTodos,
  gitDeTodos,
  gitDeTodosAsync,
  invalidarCacheGit,
  agentesDeTodos,
  TODOS,
} from '../src/agregado.js'

function arvore() {
  const raiz = mkdtempSync(join(tmpdir(), 'sle-ag-'))
  for (const [nome, branch] of [['alfa', 'main'], ['beta', 'develop']]) {
    const p = join(raiz, nome)
    mkdirSync(join(p, 'cards', 'doing'), { recursive: true })
    writeFileSync(join(p, 'cards', 'doing', `CARD-${nome}.md`),
      `---\nid: CARD-1\ntitle: Tarefa do ${nome}\nstatus: doing\nrisk: alto\n---\nx\n`)
    const git = (...a) => execFileSync('git', a, { cwd: p, stdio: 'pipe' })
    git('init', '-q', '-b', branch); git('config', 'user.email', 't@t'); git('config', 'user.name', 'T')
    git('add', '-A'); git('commit', '-qm', 'i')
  }
  writeFileSync(join(raiz, 'beta', 'sujo.txt'), 'x')
  return raiz
}

test('o board de todos junta os cards de todos os projetos', () => {
  const i = indexarTodos([arvore()])
  assert.equal(i.cards.length, 2)
  assert.equal(i.board.doing.length, 2)
})

test('cada card diz de que projeto veio, senao vira sopa', () => {
  const i = indexarTodos([arvore()])
  const nomes = i.cards.map((c) => c.projeto).sort()
  assert.deepEqual(nomes, ['alfa', 'beta'])
})

test('ids repetidos entre projetos nao se atropelam', () => {
  const i = indexarTodos([arvore()])
  // os dois cards se chamam CARD-1; a chave tem de incluir o projeto
  const chaves = i.cards.map((c) => c.chave)
  assert.equal(new Set(chaves).size, 2, `chaves colidiram: ${chaves}`)
})

test('o git agregado resume quantos repos e quantos estao sujos', () => {
  const g = gitDeTodos([arvore()])
  assert.equal(g.repos, 2)
  assert.equal(g.sujos, 1)
  assert.equal(g.branch, null, 'nao existe "a branch" de 75 repositorios')
})

test('projeto sem cards nao quebra a agregacao', () => {
  const raiz = arvore()
  mkdirSync(join(raiz, 'gama', '.git'), { recursive: true })
  assert.equal(indexarTodos([raiz]).cards.length, 2)
})

test('TODOS e um valor reservado, e nao um caminho', () => {
  assert.equal(TODOS, '*')
})

// ── as rotas que exigem UM projeto, na visão de todos ──────────────────────
import { criarDaemon } from '../src/daemon.js'

test('rota que precisa de um projeto recusa a visao de todos, e nao derruba o daemon', async () => {
  const raiz = arvore()
  const d = criarDaemon({ dados: mkdtempSync(join(tmpdir(), 'sle-agd-')), raiz })
  await new Promise((r) => d.servidor.listen(0, '127.0.0.1', r))
  const base = `http://127.0.0.1:${d.servidor.address().port}`

  // Estas dependem de um projeto: sem ele, 409 explicando -- nunca um crash.
  // `/api/agents` NÃO está aqui: ver todos os agentes de todos os projetos é
  // exatamente o que a visão de todos serve para fazer.
  for (const rota of ['/api/dir?path=sle', '/api/file?path=x.md', '/api/git/diff?file=a']) {
    const r = await fetch(`${base}${rota}${rota.includes('?') ? '&' : '?'}projeto=${encodeURIComponent(TODOS)}`)
    assert.equal(r.status, 409, `${rota} devia recusar`)
    const j = await r.json()
    assert.match(j.erro, /projeto/i)
  }

  // E o servidor continua de pé depois de todas elas.
  const vivo = await fetch(`${base}/api/projetos`)
  assert.equal(vivo.status, 200)

  const agentes = await fetch(`${base}/api/agents?projeto=${encodeURIComponent(TODOS)}`)
  assert.equal(agentes.status, 200, 'ver os agentes de todos os projetos precisa funcionar')

  d.observador.parar()
  d.servidor.closeAllConnections()
  await new Promise((r) => d.servidor.close(r))
})

test('na visao de todos, os agentes de todos os projetos aparecem juntos', () => {
  const raiz = arvore()
  for (const [nome, modelo] of [['alfa', 'opus'], ['beta', 'deepseek']]) {
    mkdirSync(join(raiz, nome, 'sle', 'agents'), { recursive: true })
    writeFileSync(join(raiz, nome, 'sle', 'agents', 'impl.json'),
      JSON.stringify({ id: 'implementer', role: 'maker', model: modelo, comando: 'echo x' }))
  }
  const a = agentesDeTodos([raiz])
  assert.equal(a.length, 2, 'mesmo id em projetos diferentes conta duas vezes')
  assert.deepEqual(a.map((x) => x.projeto).sort(), ['alfa', 'beta'])
  assert.ok(a.every((x) => x.caminhoProjeto), 'cada agente precisa saber de onde rodar')
})

test('projeto sem agentes nao aparece na lista', () => {
  assert.deepEqual(agentesDeTodos([arvore()]), [])
})

// ── desempenho ─────────────────────────────────────────────────────────────
// Medido em 2026-09-04: `git status` em 68 repositórios, em série, levava
// 11,5s. Com o SSE pedindo snapshot a cada evento, a fila crescia até a tela
// não abrir (65s por requisição).

test('o git de todos vem em paralelo e cabe num piscar de olhos', async () => {
  const raiz = arvore()
  const t0 = Date.now()
  const g = await gitDeTodosAsync([raiz])
  const gasto = Date.now() - t0
  assert.equal(g.repos, 2)
  assert.equal(g.sujos, 1)
  assert.ok(gasto < 5000, `levou ${gasto}ms`)
})

test('a segunda chamada sai do cache', async () => {
  const raiz = arvore()
  await gitDeTodosAsync([raiz])
  writeFileSync(join(raiz, 'alfa', 'novo-arquivo.txt'), 'x')
  const g = await gitDeTodosAsync([raiz])
  assert.equal(g.sujos, 1, 'o cache ainda vale; sem ele seriam 2')
})

test('invalidar faz a proxima chamada olhar os repositorios de novo', async () => {
  const raiz = arvore()
  await gitDeTodosAsync([raiz])
  writeFileSync(join(raiz, 'alfa', 'outro.txt'), 'x')
  invalidarCacheGit()
  const g = await gitDeTodosAsync([raiz])
  assert.equal(g.sujos, 2)
})
