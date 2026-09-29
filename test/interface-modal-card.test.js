import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { criarDaemon } from '../src/daemon.js'
import { abrirBrowser, acharChrome } from './apoio/browser.js'

/**
 * CARD-085: clicar no card abre um modal facil de fechar (x, Esc, clique
 * fora), com link "Abrir em nova guia", foco preso e devolvido ao card,
 * sem quebrar o filtro ?p= nem o layout mobile.
 */
const chrome = await acharChrome()
const skip = chrome ? false : 'sem Chrome nesta maquina'
let base, close, browser, projeto

const isOpen = `!document.getElementById('modal-card').hidden`
const isClosed = `document.getElementById('modal-card').hidden`
const openCard = (id) => browser.avaliar(`document.querySelector('[data-card="${id}"]').focus() ?? document.querySelector('[data-card="${id}"]').click()`)

before(async () => {
  projeto = mkdtempSync(join(tmpdir(), 'sle-modal-'))
  mkdirSync(join(projeto, 'cards', 'backlog'), { recursive: true })
  mkdirSync(join(projeto, 'cards', 'pendente-diego'), { recursive: true })
  writeFileSync(join(projeto, 'cards', 'backlog', 'CARD-200.md'),
    '---\nid: CARD-200\ntitle: Tarefa dois cem\nstatus: backlog\nprioridade: P0\n---\nnotas do card\n')
  writeFileSync(join(projeto, 'cards', 'backlog', 'CARD-201.md'),
    '---\nid: CARD-201\ntitle: Outra\nstatus: backlog\nprioridade: P1\n---\ncorpo\n')
  writeFileSync(join(projeto, 'cards', 'pendente-diego', 'CARD-202.md'),
    '---\nid: CARD-202\ntitle: Decida\nstatus: pendente-diego\n---\ndecida algo\n')
  const d = criarDaemon({ dados: mkdtempSync(join(tmpdir(), 'sle-modal-bd-')), projeto })
  await new Promise((r) => d.servidor.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${d.servidor.address().port}`
  close = () => new Promise((r) => (d.observador.parar(), d.servidor.closeAllConnections(), d.servidor.close(r)))
  if (!chrome) return
  browser = await abrirBrowser()
  await browser.ir(`${base}/board?p=P0`)
  await browser.esperar(`document.body.dataset.pronto === 'sim'`)
  await browser.esperar(`!!document.querySelector('[data-card="CARD-200"]')`)
})
after(async () => { await browser?.fechar(); await close?.() })

test('CARD-085: clique no card abre o modal com titulo, coluna/notas e link para nova guia', { skip }, async () => {
  await openCard('CARD-200')
  await browser.esperar(isOpen)
  assert.equal(await browser.avaliar(`document.getElementById('modal-titulo').textContent`), 'Tarefa dois cem')
  assert.match(await browser.avaliar(`document.getElementById('modal-corpo').textContent`), /notas do card/)
  const link = await browser.avaliar(`(() => { const a = document.getElementById('modal-nova-guia'); return [a.getAttribute('href'), a.target] })()`)
  assert.equal(link[0], '/card/CARD-200?p=P0')
  assert.equal(link[1], '_blank')
})

test('CARD-085: acessibilidade -- aria-modal, rotulo e foco dentro do modal', { skip }, async () => {
  assert.equal(await browser.avaliar(`document.querySelector('#modal-card [role=dialog]').getAttribute('aria-modal')`), 'true')
  assert.equal(await browser.avaliar(`document.querySelector('#modal-card [role=dialog]').getAttribute('aria-labelledby')`), 'modal-titulo')
  assert.equal(await browser.avaliar(`document.getElementById('modal-card').contains(document.activeElement)`), true)
})

test('CARD-085: Tab e Shift+Tab nao escapam do modal (foco preso)', { skip }, async () => {
  const r = await browser.avaliar(`(() => {
    const caixa = document.querySelector('#modal-card .modal-caixa')
    const f = [...caixa.querySelectorAll('a[href],button,textarea,input,[tabindex]:not([tabindex="-1"])')].filter((e) => e.offsetParent !== null && !e.disabled)
    f.at(-1).focus()
    const a = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })
    document.dispatchEvent(a)
    const noPrimeiro = document.activeElement === f[0]
    const b = new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true })
    document.dispatchEvent(b)
    return [noPrimeiro, document.activeElement === f.at(-1)]
  })()`)
  assert.deepEqual(r, [true, true])
})

test('CARD-085: Esc fecha, devolve o foco ao card e preserva ?p=', { skip }, async () => {
  await browser.avaliar(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`)
  await browser.esperar(isClosed)
  assert.equal(await browser.avaliar(`document.activeElement?.dataset?.card`), 'CARD-200')
  assert.equal(await browser.avaliar(`location.pathname + location.search`), '/board?p=P0')
})

test('CARD-085: botao x fecha e o filtro ?p= segue valendo', { skip }, async () => {
  await openCard('CARD-200')
  await browser.esperar(isOpen)
  assert.equal(await browser.avaliar(`location.search`), '?p=P0')
  await browser.avaliar(`document.getElementById('modal-fechar').click()`)
  await browser.esperar(isClosed)
  assert.equal(await browser.avaliar(`document.activeElement?.dataset?.card`), 'CARD-200')
  assert.equal(await browser.avaliar(`!!document.querySelector('[data-card="CARD-201"]')`), false)
})

test('CARD-085: clique fora (no fundo) fecha; clique dentro nao', { skip }, async () => {
  await openCard('CARD-200')
  await browser.esperar(isOpen)
  await browser.avaliar(`document.querySelector('#modal-card .modal-caixa').click()`)
  assert.equal(await browser.avaliar(isOpen), true)
  await browser.avaliar(`document.getElementById('modal-card').click()`)
  await browser.esperar(isClosed)
})

test('CARD-085: aba do board nao rola sozinha nem perde a posicao ao openCard/close', { skip }, async () => {
  const antes = await browser.avaliar(`document.scrollingElement.scrollTop`)
  await openCard('CARD-200')
  await browser.esperar(isOpen)
  await browser.avaliar(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`)
  await browser.esperar(isClosed)
  assert.equal(await browser.avaliar(`document.scrollingElement.scrollTop`), antes)
})

test('CARD-085: card pendente mostra "Minha resposta"', { skip }, async () => {
  await browser.ir(`${base}/board`)
  await browser.esperar(`!!document.querySelector('[data-card="CARD-202"]')`)
  await openCard('CARD-202')
  await browser.esperar(isOpen)
  assert.equal(await browser.avaliar(`document.querySelector('.modal-resposta').hidden`), false)
  assert.match(await browser.avaliar(`document.querySelector('.modal-resposta h3').textContent`), /Minha resposta/)
  await browser.avaliar(`document.getElementById('modal-fechar').click()`)
})

test('CARD-085: em 400 px o modal ocupa a tela inteira', { skip }, async () => {
  await browser.viewport(400, 700)
  await openCard('CARD-202')
  await browser.esperar(isOpen)
  const r = await browser.avaliar(`(() => { const b = document.querySelector('#modal-card .modal-caixa').getBoundingClientRect(); const o = document.getElementById('modal-card').getBoundingClientRect(); return [Math.round(b.width) === Math.round(o.width), Math.round(b.height), b.width >= o.width - 1 && document.querySelector(".modal-caixa").scrollWidth <= b.width] })()`)
  assert.deepEqual(r, [true, 700, true])
  await browser.viewport(1440, 800)
})
