import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { criarDaemon } from '../src/daemon.js'
import { abrirBrowser, acharChrome } from './apoio/browser.js'

const chrome = await acharChrome()
const pular = chrome ? false : 'sem Chrome nesta maquina'
let base, fechar, browser, projeto

before(async () => {
  projeto = mkdtempSync(join(tmpdir(), 'sle-board-'))
  for (const col of ['backlog', 'doing', 'review']) mkdirSync(join(projeto, 'cards', col), { recursive: true })
  writeFileSync(join(projeto, 'cards', 'doing', 'CARD-042.md'),
    '---\nid: CARD-042\ntitle: Token opaco com refresh\nstatus: doing\nrisk: alto\nbudget_usd: 8\n---\n\n## Requisitos\n\nR1. O sistema DEVE invalidar o refresh anterior.\n')
  writeFileSync(join(projeto, 'cards', 'backlog', 'CARD-007.md'),
    '---\nid: CARD-007\ntitle: Exportar relatorio\nstatus: backlog\nrisk: baixo\n---\ncorpo\n')

  const d = criarDaemon({ dados: mkdtempSync(join(tmpdir(), 'sle-bd-')), projeto })
  await new Promise((r) => d.servidor.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${d.servidor.address().port}`
  fechar = () => new Promise((r) => (d.observador.parar(), d.servidor.closeAllConnections(), d.servidor.close(r)))
  if (!chrome) return
  browser = await abrirBrowser()
  await browser.ir(base)
  await browser.esperar(`document.body.dataset.pronto === 'sim'`)
})
after(async () => { await browser?.fechar(); await fechar?.() })

test('da para trocar de tela sem recarregar a pagina', { skip: pular }, async () => {
  await browser.avaliar(`document.querySelector('nav button[data-tela="board"]').click()`)
  await browser.esperar(`document.getElementById('tela-board').offsetParent !== null`)
  // Visibilidade de verdade, e nao a propriedade: uma regra de CSS com
  // especificidade maior vence o `hidden` e a propriedade continua dizendo true.
  assert.equal(
    await browser.avaliar(`document.getElementById('tela-fluxo').offsetParent === null`),
    true,
    'a tela anterior precisa sumir de fato, nao so no atributo'
  )
})

test('o board mostra as colunas do pipeline e os cards em cada uma', { skip: pular }, async () => {
  await browser.esperar(`document.querySelectorAll('#tela-board .coluna').length === 7`)
  const texto = await browser.avaliar(`document.getElementById('tela-board').textContent`)
  assert.match(texto, /Token opaco com refresh/)
  assert.match(texto, /Exportar relatorio/)
  const naDoing = await browser.avaliar(
    `document.querySelector('#tela-board .coluna[data-coluna="doing"]').textContent`)
  assert.match(naDoing, /CARD-042/)
  assert.doesNotMatch(naDoing, /CARD-007/, 'card nao pode aparecer na coluna errada')
})

test('risco alto e visivel sem precisar abrir o card', { skip: pular }, async () => {
  const classes = await browser.avaliar(
    `document.querySelector('#tela-board [data-card="CARD-042"]').className`)
  assert.match(classes, /risco-alto/)
})

test('clicar num card abre a spec dele', { skip: pular }, async () => {
  await browser.avaliar(`document.querySelector('#tela-board [data-card="CARD-042"]').click()`)
  await browser.esperar(`document.getElementById('tela-card').offsetParent !== null`)
  const texto = await browser.avaliar(`document.getElementById('tela-card').textContent`)
  assert.match(texto, /R1\. O sistema DEVE invalidar/)
  assert.match(texto, /alto/)
  assert.match(texto, /8/)
})

test('a tela nao registra erro de JavaScript em nenhuma aba', { skip: pular }, async () => {
  assert.deepEqual(browser.erros, [], browser.erros.join(' | '))
})
