import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { criarDaemon } from '../src/daemon.js'

let base, fechar, projeto

before(async () => {
  projeto = mkdtempSync(join(tmpdir(), 'sle-proj-'))
  mkdirSync(join(projeto, 'cards', 'doing'), { recursive: true })
  writeFileSync(join(projeto, 'cards', 'doing', 'CARD-042.md'),
    '---\nid: CARD-042\ntitle: Token opaco\nstatus: doing\nrisk: alto\nbudget_usd: 8\n---\n\n## Requisitos\n\nR1. DEVE invalidar.\n')
  const git = (...a) => execFileSync('git', a, { cwd: projeto, stdio: 'pipe' })
  git('init', '-q', '-b', 'main'); git('config', 'user.email', 't@t'); git('config', 'user.name', 'T')
  git('add', '-A'); git('commit', '-qm', 'cards')

  const d = criarDaemon({ dados: mkdtempSync(join(tmpdir(), 'sle-dd-')), projeto })
  await new Promise((r) => d.servidor.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${d.servidor.address().port}`
  fechar = () => new Promise((r) => (d.observador.parar(), d.servidor.closeAllConnections(), d.servidor.close(r)))
})
after(async () => { await fechar?.() })

const pegar = async (rota) => (await fetch(base + rota)).json()

test('o board vem agrupado por coluna', async () => {
  const r = await pegar('/api/cards')
  assert.equal(r.cards.length, 1)
  assert.equal(r.board.doing[0].id, 'CARD-042')
  assert.equal(r.board.backlog.length, 0)
})

test('o card traz a spec renderizavel, nao so o frontmatter', async () => {
  const c = await pegar('/api/cards/CARD-042')
  assert.equal(c.title, 'Token opaco')
  assert.equal(c.risk, 'alto')
  assert.match(c.corpo, /R1\. DEVE invalidar/)
})

test('card inexistente e 404, nao um objeto vazio', async () => {
  assert.equal((await fetch(`${base}/api/cards/NAO-EXISTE`)).status, 404)
})

test('id com travessia de caminho nao vira leitura de arquivo', async () => {
  const r = await fetch(`${base}/api/cards/..%2f..%2fetc%2fpasswd`)
  assert.equal(r.status, 404)
})

test('o estado do git da arvore observada', async () => {
  const g = await pegar('/api/git/tree')
  assert.equal(g.branch, 'main')
  assert.equal(typeof g.sujo, 'boolean')
})

test('o diff e por arquivo, e recusa caminho de fora', async () => {
  writeFileSync(join(projeto, 'cards', 'doing', 'CARD-042.md'), '---\nid: CARD-042\ntitle: Mudou\nstatus: doing\n---\nx\n')
  const d = await pegar('/api/git/diff?file=cards/doing/CARD-042.md')
  assert.match(d.diff, /Mudou/)
  const fora = await pegar('/api/git/diff?file=../../etc/passwd')
  assert.equal(fora.diff, '')
})

test('o snapshot passa a incluir o board e o git, numa chamada so', async () => {
  const s = await pegar('/api/snapshot')
  assert.ok(s.cards, 'a tela inicial nao pode precisar de tres chamadas')
  assert.ok(s.git)
  assert.ok(s.sessoes)
})
