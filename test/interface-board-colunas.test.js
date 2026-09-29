import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { criarDaemon } from '../src/daemon.js'
import { abrirBrowser, acharChrome } from './apoio/browser.js'

// CARD-220: a coluna pendente-diego sumia quando vazia e o numero de cada coluna
// parecia pertencer a coluna vizinha (numero colado na borda direita do cabecalho).
const chrome = await acharChrome()
const pular = chrome ? false : 'sem Chrome nesta maquina'
const ORDEM = ['backlog', 'refinamento', 'aprovado', 'doing', 'review', 'testando', 'done', 'pendente-diego', 'recurring']
let fechar, browser

const card = (id, col) => `---\nid: ${id}\ntitle: Card ${id}\nstatus: ${col}\nrisk: baixo\n---\ncorpo\n`

before(async () => {
  const projeto = mkdtempSync(join(tmpdir(), 'sle-cols-'))
  // pendente-diego, refinamento e testando: pastas inexistentes/vazias de proposito.
  const povoado = { backlog: 2, aprovado: 3, doing: 5, review: 6, done: 1 }
  let n = 100
  for (const [col, qtd] of Object.entries(povoado)) {
    mkdirSync(join(projeto, 'cards', col), { recursive: true })
    for (let i = 0; i < qtd; i++) writeFileSync(join(projeto, 'cards', col, `CARD-${++n}.md`), card(`CARD-${n}`, col))
  }
  mkdirSync(join(projeto, 'cards', 'refinamento'), { recursive: true })
  const d = criarDaemon({ dados: mkdtempSync(join(tmpdir(), 'sle-cd-')), projeto })
  await new Promise((r) => d.servidor.listen(0, '127.0.0.1', r))
  const base = `http://127.0.0.1:${d.servidor.address().port}`
  fechar = () => new Promise((r) => (d.observador.parar(), d.servidor.closeAllConnections(), d.servidor.close(r)))
  if (!chrome) return
  browser = await abrirBrowser()
  await browser.ir(base)
  await browser.esperar(`document.body.dataset.pronto === 'sim'`)
  await browser.avaliar(`document.querySelector('nav button[data-tela="board"]').click()`)
  await browser.esperar(`document.querySelectorAll('#colunas .coluna').length > 0`)
})
after(async () => { await browser?.fechar(); await fechar?.() })

const lerColunas = () => browser.avaliar(`JSON.stringify([...document.querySelectorAll('#colunas .coluna')].map((c) => ({
  coluna: c.dataset.coluna,
  qtd: c.querySelector('h3 .qtd').textContent,
  cards: c.querySelectorAll(':scope > div > a').length,
  gap: Math.round(c.querySelector('h3 .qtd').getBoundingClientRect().left - c.querySelector('h3 .nome').getBoundingClientRect().right),
})))`).then(JSON.parse)

test('todas as colunas fixas aparecem, vazias ou nao, na ordem do board da CLI', { skip: pular }, async () => {
  const cols = await lerColunas()
  assert.deepEqual(cols.map((c) => c.coluna), ORDEM)
})

test('coluna vazia mostra 0 e cada contador bate com os cards da PROPRIA coluna', { skip: pular }, async () => {
  const cols = Object.fromEntries((await lerColunas()).map((c) => [c.coluna, c]))
  for (const [col, esperado] of Object.entries({ 'pendente-diego': 0, refinamento: 0, testando: 0, backlog: 2, aprovado: 3, doing: 5, review: 6, done: 1 })) {
    assert.equal(cols[col].qtd, String(esperado), `contador de ${col}`)
    assert.equal(cols[col].cards, esperado, `cards de ${col}`)
  }
})

test('o contador fica colado ao nome da propria coluna, nao na borda da vizinha', { skip: pular }, async () => {
  for (const c of await lerColunas()) assert.ok(c.gap >= 0 && c.gap <= 24, `${c.coluna}: contador a ${c.gap}px do nome`)
})
