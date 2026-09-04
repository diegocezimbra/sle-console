import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { criarDaemon } from '../src/daemon.js'

let base, fechar, projeto

before(async () => {
  projeto = mkdtempSync(join(tmpdir(), 'sle-w-'))
  mkdirSync(join(projeto, 'cards', 'doing'), { recursive: true })
  mkdirSync(join(projeto, 'sle', 'gates'), { recursive: true })
  writeFileSync(join(projeto, 'sle', 'gates', 'pipeline.json'),
    JSON.stringify({ stages: [], gates: [{ id: 'G1', name: 'Req', after: 'E1', mode: 'human' }] }, null, 2))
  const d = criarDaemon({ dados: mkdtempSync(join(tmpdir(), 'sle-wd-')), projeto })
  await new Promise((r) => d.servidor.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${d.servidor.address().port}`
  fechar = () => new Promise((r) => (d.observador.parar(), d.servidor.closeAllConnections(), d.servidor.close(r)))
})
after(async () => { await fechar?.() })

const put = (caminho, corpo) =>
  fetch(`${base}/api/file?path=${encodeURIComponent(caminho)}`, { method: 'PUT', body: corpo })

test('le o conteudo bruto de um arquivo do escopo', async () => {
  const r = await fetch(`${base}/api/file?path=sle/gates/pipeline.json`)
  const j = await r.json()
  assert.match(j.conteudo, /"G1"/)
})

test('leitura de arquivo fora do escopo e recusada', async () => {
  const j = await (await fetch(`${base}/api/file?path=../../etc/passwd`)).json()
  assert.equal(j.conteudo, undefined)
  assert.ok(j.erro)
})

test('salva e o disco reflete', async () => {
  const novo = '---\nid: CARD-9\ntitle: Novo\nstatus: doing\n---\ncorpo\n'
  const r = await put('cards/doing/CARD-9.md', novo)
  assert.equal(r.status, 200)
  assert.equal(readFileSync(join(projeto, 'cards/doing/CARD-9.md'), 'utf8'), novo)
})

test('conteudo invalido e recusado com 422 e nao toca no disco', async () => {
  const r = await put('sle/gates/pipeline.json', '{ quebrado')
  assert.equal(r.status, 422)
  const j = await r.json()
  assert.match(j.erro, /JSON/i)
  assert.match(readFileSync(join(projeto, 'sle/gates/pipeline.json'), 'utf8'), /"G1"/, 'o arquivo bom precisa continuar la')
})

test('gate com modo inexistente e recusado', async () => {
  const mau = JSON.stringify({ gates: [{ id: 'G2', name: 'X', after: 'E1', mode: 'quem sabe' }] })
  assert.equal((await put('sle/gates/pipeline.json', mau)).status, 422)
})

test('escrita fora da allowlist e recusada com 403', async () => {
  const r = await put('node_modules/x.js', 'x')
  assert.equal(r.status, 403)
  assert.equal(existsSync(join(projeto, 'node_modules/x.js')), false)
})

test('o botao "testar agora" roda o comando de verdade no projeto', async () => {
  const r = await fetch(`${base}/api/gates/test`, {
    method: 'POST',
    body: JSON.stringify({ comando: 'echo verificado && exit 0' }),
  })
  const j = await r.json()
  assert.equal(j.exit, 0)
  assert.match(j.saida, /verificado/)
})

test('comando que falha volta com o codigo, e nao como erro do daemon', async () => {
  const j = await (await fetch(`${base}/api/gates/test`, {
    method: 'POST', body: JSON.stringify({ comando: 'exit 7' }),
  })).json()
  assert.equal(j.exit, 7)
})
