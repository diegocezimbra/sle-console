/**
 * CARD-240 (entrega 2): arquivo que o DEUS manda pelo chat. Imagem aparece inline; pdf/md/csv/json aparecem como
 * download com nome e tamanho; a linha `[anexo: ...]` (para quem le so o jsonl) some da tela.
 */
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { criarDaemon } from '../src/daemon.js'
import { abrirBrowser, acharChrome } from './apoio/browser.js'
import { makePng } from './apoio/png.js'

const chrome = await acharChrome()
const pular = chrome ? false : 'sem Chrome nesta maquina'
const DIA = '2026-09-29'
let base, fechar, browser

before(async () => {
  const dir = mkdtempSync(join(tmpdir(), 'sle-ifiles-'))
  process.env.CONSOLE_CHAT_DIR = dir
  mkdirSync(join(dir, 'chat', 'anexos', DIA), { recursive: true })
  writeFileSync(join(dir, 'chat', 'anexos', DIA, 'x1-1.png'), makePng(8, 8, [9, 9, 9]))
  const cite = (n) => `\n\n[anexo: chat/anexos/${DIA}/${n}]`
  const linhas = [
    { ts: `${DIA}T10:00:00.000Z`, de: 'deus', id: 'm1', texto: `segue o grafico${cite('x1-1.png')}`, anexos: [{ arquivo: `chat/anexos/${DIA}/x1-1.png`, tipo: 'image/png', bytes: 120, nome: 'grafico.png' }] },
    { ts: `${DIA}T10:01:00.000Z`, de: 'deus', id: 'm2', texto: `e o relatorio${cite('x2-1.pdf')}`, anexos: [{ arquivo: `chat/anexos/${DIA}/x2-1.pdf`, tipo: 'application/pdf', bytes: 2411520, nome: 'relatório final.pdf' }] },
    { ts: `${DIA}T10:02:00.000Z`, de: 'deus', id: 'm3', texto: `dados${cite('x3-1.csv')}`, anexos: [{ arquivo: `chat/anexos/${DIA}/x3-1.csv`, tipo: 'text/csv', bytes: 900, nome: 'dados.csv' }] },
  ]
  writeFileSync(join(dir, 'chat', `${DIA}.jsonl`), linhas.map((l) => JSON.stringify(l)).join('\n') + '\n')
  const d = criarDaemon({ dados: mkdtempSync(join(tmpdir(), 'sle-ifiles-d-')) })
  await new Promise((r) => d.servidor.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${d.servidor.address().port}`
  fechar = () => new Promise((r) => { d.observador.parar(); d.pararGit(); d.servidor.closeAllConnections(); d.servidor.close(r) })
  if (chrome) browser = await abrirBrowser()
})
after(async () => {
  delete process.env.CONSOLE_CHAT_DIR
  await browser?.fechar()
  await fechar?.()
})

const abrir = async () => {
  await browser.ir(`${base}/chat?poll=60000`)
  await browser.esperar(`document.body.dataset.pronto === 'sim'`)
}

test('imagem do DEUS aparece inline, sem chip de download', { skip: pular }, async () => {
  await abrir()
  assert.deepEqual(browser.erros, [])
  assert.equal(await browser.avaliar(`document.querySelectorAll('[data-id="m1"] .anexo img').length`), 1)
  assert.equal(await browser.avaliar(`document.querySelectorAll('[data-id="m1"] a.arquivo').length`), 0)
})

test('pdf vira download com nome, extensao e tamanho em MB; o link leva o nome original', { skip: pular }, async () => {
  await abrir()
  assert.equal(await browser.avaliar(`document.querySelector('[data-id="m2"] a.arquivo .arquivo-nome').textContent`), 'relatório final.pdf')
  assert.equal(await browser.avaliar(`document.querySelector('[data-id="m2"] a.arquivo .arquivo-ext').textContent`), 'PDF')
  assert.equal(await browser.avaliar(`document.querySelector('[data-id="m2"] a.arquivo .arquivo-tam').textContent`), '2,3 MB')
  const href = await browser.avaliar(`document.querySelector('[data-id="m2"] a.arquivo').getAttribute('href')`)
  assert.equal(href, `/api/chat/anexos/${DIA}/x2-1.pdf?nome=relat%C3%B3rio%20final.pdf`)
  assert.equal(await browser.avaliar(`document.querySelector('[data-id="m2"] a.arquivo').getAttribute('download')`), 'relatório final.pdf')
})

test('tamanho pequeno em KB e a linha [anexo: ...] nao aparece no texto', { skip: pular }, async () => {
  await abrir()
  assert.equal(await browser.avaliar(`document.querySelector('[data-id="m3"] a.arquivo .arquivo-tam').textContent`), '900 B')
  assert.equal(await browser.avaliar(`document.querySelector('[data-id="m3"] .corpo').textContent.trim()`), 'dados')
})

test('o chip e um alvo de toque de 44 px no celular (390x844) e nao estoura a largura', { skip: pular }, async () => {
  await browser.celular(390, 844)
  await abrir()
  const alturas = await browser.avaliar(`[...document.querySelectorAll('a.arquivo')].map((a) => Math.round(a.getBoundingClientRect().height))`)
  assert.ok(alturas.length === 2 && alturas.every((h) => h >= 44), `alturas ${alturas}`)
  assert.equal(await browser.avaliar(`document.documentElement.scrollWidth <= window.innerWidth`), true)
})
