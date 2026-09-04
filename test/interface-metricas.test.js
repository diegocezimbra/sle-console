import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { criarDaemon } from '../src/daemon.js'
import { abrirBrowser, acharChrome } from './apoio/browser.js'

const chrome = await acharChrome()
const pular = chrome ? false : 'sem Chrome nesta maquina'
let base, fechar, browser, projeto

before(async () => {
  projeto = mkdtempSync(join(tmpdir(), 'sle-im-'))
  for (const c of ['doing', 'review']) mkdirSync(join(projeto, 'cards', c), { recursive: true })
  mkdirSync(join(projeto, 'sle', 'gates'), { recursive: true })
  writeFileSync(join(projeto, 'cards', 'doing', 'CARD-1.md'),
    '---\nid: CARD-1\ntitle: Mover me\nstatus: doing\nrisk: baixo\n---\ncorpo\n')
  writeFileSync(join(projeto, 'sle', 'gates', 'pipeline.json'), JSON.stringify({
    gates: [{ id: 'GV2', name: 'Suite', after: 'V2', mode: 'auto',
      verify: { type: 'command', run: 'exit 1' } }] }))

  const d = criarDaemon({ dados: mkdtempSync(join(tmpdir(), 'sle-imd-')), projeto })
  await new Promise((r) => d.servidor.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${d.servidor.address().port}`
  await fetch(`${base}/api/gates/GV2/decide`, { method: 'POST', body: JSON.stringify({ card: { id: 'CARD-1' } }) })
  await fetch(`${base}/api/hook`, { method: 'POST', body: JSON.stringify({
    session_id: 'filho', hook_event_name: 'SubagentStart',
    agent_type: 'adversarial-reviewer', parent_agent: 'implementer' }) })

  fechar = () => new Promise((r) => (d.observador.parar(), d.servidor.closeAllConnections(), d.servidor.close(r)))
  if (!chrome) return
  browser = await abrirBrowser()
  await browser.ir(base)
  await browser.esperar(`document.body.dataset.pronto === 'sim'`)
})
after(async () => { await browser?.fechar(); await fechar?.() })

test('a tela de metricas mostra o que foi medido', { skip: pular }, async () => {
  await browser.avaliar(`document.querySelector('nav button[data-tela="metricas"]').click()`)
  await browser.esperar(`document.querySelectorAll('#metricas .metrica').length > 0`)
  const t = await browser.avaliar(`document.getElementById('metricas').textContent`)
  assert.match(t, /reprova/i)
})

test('metrica sem dado mostra o motivo, e nunca um zero', { skip: pular }, async () => {
  const t = await browser.avaliar(`document.getElementById('metricas').textContent`)
  assert.match(t, /fora do console/i, 'zero seria uma afirmacao falsa')
  const zeros = await browser.avaliar(
    `[...document.querySelectorAll('#metricas .metrica.sem-dado .valor')].map(e=>e.textContent).join('|')`)
  assert.doesNotMatch(zeros, /^0$|\|0\|/, 'metrica sem dado nao pode exibir 0')
})

test('o grafo de agentes desenha a aresta pai-filho', { skip: pular }, async () => {
  const pintou = await browser.avaliar(`(() => {
    const c = document.getElementById('grafo')
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data
    for (let i = 3; i < d.length; i += 4) if (d[i] > 0) return true
    return false
  })()`)
  assert.equal(pintou, true, 'com uma aresta no snapshot o grafo nao pode ficar em branco')
})

test('mover um card pela tela muda a coluna e o disco', { skip: pular }, async () => {
  await browser.avaliar(`document.querySelector('nav button[data-tela="board"]').click()`)
  await browser.esperar(`document.querySelector('[data-card="CARD-1"]') !== null`)
  await browser.avaliar(`document.querySelector('[data-mover="CARD-1"][data-dir="1"]').click()`)
  await browser.esperar(
    `document.querySelector('.coluna[data-coluna="review"] [data-card="CARD-1"]') !== null`)
  assert.equal(existsSync(join(projeto, 'cards/review/CARD-1.md')), true)
  assert.equal(existsSync(join(projeto, 'cards/doing/CARD-1.md')), false)
})

/// O canvas num flex-column estica se ninguém der altura a ele -- e empurra
/// todas as métricas para fora da tela. Pixel pintado não pega isso.
test('o grafo tem altura fixa e nao engole a tela', { skip: pular }, async () => {
  await browser.avaliar(`document.querySelector('nav button[data-tela="metricas"]').click()`)
  await browser.esperar(`document.getElementById('grafo').offsetParent !== null`)
  const altura = await browser.avaliar(`document.getElementById('grafo').getBoundingClientRect().height`)
  assert.ok(altura > 100 && altura < 320, `o grafo ficou com ${altura}px de altura`)
})

test('as metricas ficam visiveis na tela, e nao empurradas para baixo', { skip: pular }, async () => {
  const visivel = await browser.avaliar(`(() => {
    const m = document.querySelector('#metricas .metrica')
    if (!m) return false
    const r = m.getBoundingClientRect()
    return r.top < window.innerHeight && r.height > 0
  })()`)
  assert.equal(visivel, true, 'a primeira métrica precisa caber na tela sem rolar')
})

test('nenhum erro de JavaScript nas telas novas', { skip: pular }, async () => {
  assert.deepEqual(browser.erros, [], browser.erros.join(' | '))
})
