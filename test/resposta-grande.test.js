import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { criarDaemon } from '../src/daemon.js'

let base, fechar, projeto

before(async () => {
  projeto = mkdtempSync(join(tmpdir(), 'sle-rg-'))
  mkdirSync(join(projeto, 'cards', 'doing'), { recursive: true })
  writeFileSync(join(projeto, 'cards', 'doing', 'CARD-1.md'), '---\nid: CARD-1\ntitle: Grande\nstatus: doing\n---\ncorpo\n')
  const d = criarDaemon({ dados: mkdtempSync(join(tmpdir(), 'sle-rgd-')), projeto })
  await new Promise((r) => d.servidor.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${d.servidor.address().port}`
  fechar = () => new Promise((r) => (d.observador.parar(), d.servidor.closeAllConnections(), d.servidor.close(r)))
})
after(async () => { await fechar?.() })

const responder = (text) =>
  fetch(`${base}/api/cards/CARD-1/answer`, { method: 'POST', body: JSON.stringify({ option: '', text }) })

test('resposta de 100 KB e gravada no card sem perda', async () => {
  const texto = ('curl -H "x: y" https://exemplo.com/' + 'a'.repeat(60) + '\n').repeat(1100).trim()
  assert.ok(texto.length > 100_000)
  const r = await responder(texto)
  assert.equal(r.status, 200)
  assert.equal((await r.json()).text.length, texto.length)
  assert.ok(readFileSync(join(projeto, 'cards', 'doing', 'CARD-1.md'), 'utf8').includes(texto))
})

test('acima de 1 MB continua recusada com 422', async () => {
  const r = await responder('x'.repeat(1_000_001))
  assert.equal(r.status, 422)
})
