import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { criarDaemon } from '../src/daemon.js'
import { abrirBrowser, acharChrome } from './apoio/browser.js'

/**
 * CARD-120 (etiquetas): "quero tags nos itens do board onde fique fácil
 * identificar as tarefas de maior prioridade... cadê as de prioridade alta?"
 * Cobre o que interface-board.test.js não cobre: os 5 chips + "todas" com
 * contagem, e o filtro sobrevivendo a um F5 (estado na URL).
 */
const chrome = await acharChrome()
const pular = chrome ? false : 'sem Chrome nesta maquina'
let base, fechar, browser, projeto

before(async () => {
  projeto = mkdtempSync(join(tmpdir(), 'sle-prio-'))
  mkdirSync(join(projeto, 'cards', 'backlog'), { recursive: true })
  const card = (id, prioridade) =>
    writeFileSync(join(projeto, 'cards', 'backlog', `${id}.md`),
      `---\nid: ${id}\ntitle: Tarefa ${id}\nstatus: backlog${prioridade ? `\nprioridade: ${prioridade}` : ''}\n---\ncorpo\n`)
  card('CARD-100', 'P-1')
  card('CARD-101', 'P0')
  card('CARD-102', 'P0')
  card('CARD-103', 'P1')
  card('CARD-104', null) // sem prioridade -> P3

  const d = criarDaemon({ dados: mkdtempSync(join(tmpdir(), 'sle-prio-bd-')), projeto })
  await new Promise((r) => d.servidor.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${d.servidor.address().port}`
  fechar = () => new Promise((r) => (d.observador.parar(), d.servidor.closeAllConnections(), d.servidor.close(r)))
  if (!chrome) return
  browser = await abrirBrowser()
  await browser.ir(base)
  await browser.esperar(`document.body.dataset.pronto === 'sim'`)
  await browser.avaliar(`document.querySelector('nav button[data-tela="board"]').click()`)
  await browser.esperar(`document.getElementById('tela-board').offsetParent !== null`)
})
after(async () => { await browser?.fechar(); await fechar?.() })

test('CARD-120: a barra mostra "todas" + os 5 chips de prioridade, cada um com contagem', { skip: pular }, async () => {
  const rotulos = await browser.avaliar(
    `[...document.querySelectorAll('#filtro-prioridade .chip-prioridade')].map((b) => b.textContent)`)
  assert.deepEqual(rotulos, [
    'todas (5)', 'URGENTE (1)', 'ALTÍSSIMA (2)', 'ALTA (1)', 'MÉDIA (0)', 'BAIXA (1)',
  ])
})

test('CARD-120: cada chip carrega o código P no data-p e no title, pra quem le so o rotulo humano ainda achar o P', { skip: pular }, async () => {
  const pares = await browser.avaliar(
    `[...document.querySelectorAll('#filtro-prioridade [data-p]')].map((b) => [b.dataset.p, b.title])`)
  assert.deepEqual(pares, [['P-1', 'P-1'], ['P0', 'P0'], ['P1', 'P1'], ['P2', 'P2'], ['P3', 'P3']])
})

test('CARD-120: filtro é multi-seleção -- dois chips marcados mostram a união dos dois P', { skip: pular }, async () => {
  await browser.avaliar(`document.querySelector('#filtro-prioridade [data-p="P-1"]').click()`)
  await browser.avaliar(`document.querySelector('#filtro-prioridade [data-p="P1"]').click()`)
  await browser.esperar(`document.querySelectorAll('#tela-board .card').length === 2`)
  const texto = await browser.avaliar(`document.getElementById('colunas').textContent`)
  assert.match(texto, /CARD-100/)
  assert.match(texto, /CARD-103/)
  assert.doesNotMatch(texto, /CARD-101/)
  // limpa pro proximo teste
  await browser.avaliar(`document.querySelector('#filtro-prioridade .chip-todas').click()`)
  await browser.esperar(`document.querySelectorAll('#tela-board .card').length === 5`)
})

test('CARD-120: o filtro escolhido vai pra URL (?p=) e sobrevive a um F5', { skip: pular }, async () => {
  await browser.avaliar(`document.querySelector('#filtro-prioridade [data-p="P0"]').click()`)
  await browser.esperar(`location.search.includes('p=P0')`)

  const urlComFiltro = await browser.avaliar('location.href')
  await browser.ir(urlComFiltro)
  await browser.esperar(`document.body.dataset.pronto === 'sim'`)
  await browser.avaliar(`document.querySelector('nav button[data-tela="board"]').click()`)

  await browser.esperar(`document.querySelectorAll('#tela-board .card').length === 2`)
  assert.equal(
    await browser.avaliar(`document.querySelector('#filtro-prioridade [data-p="P0"]').getAttribute('aria-pressed')`),
    'true'
  )
  const texto = await browser.avaliar(`document.getElementById('colunas').textContent`)
  assert.match(texto, /CARD-101/)
  assert.match(texto, /CARD-102/)
  assert.doesNotMatch(texto, /CARD-100/)

  // devolve pro estado default -- nao ha mais testes depois deste no arquivo,
  // mas o habito evita o proximo agente herdar um filtro ligado por engano.
  await browser.avaliar(`document.querySelector('#filtro-prioridade .chip-todas').click()`)
})

test('a tela nao registra erro de JavaScript em nenhuma aba', { skip: pular }, async () => {
  assert.deepEqual(browser.erros, [], browser.erros.join(' | '))
})
