/**
 * CARD-227: o chat mostra a conversa espelhada da sessao DEUS (VS Code) na ordem em que foi dita,
 * mesmo quando o espelho publica retardatario, e marca de onde ela veio.
 */
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { appendFileSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { criarDaemon } from '../src/daemon.js'
import { abrirBrowser, acharChrome } from './apoio/browser.js'

const chrome = await acharChrome()
const pular = chrome ? false : 'sem Chrome nesta maquina'
const linha = (ts, de, texto, extra = {}) => JSON.stringify({ ts, de, texto, id: `id-${ts}`, ...extra }) + '\n'
let dir, arquivo, base, fechar, browser

before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'sle-ichat-'))
  process.env.CONSOLE_CHAT_DIR = dir
  mkdirSync(join(dir, 'chat'))
  arquivo = join(dir, 'chat', '2026-09-29.jsonl')
  writeFileSync(arquivo, linha('2026-09-29T10:00:00.000Z', 'diego', 'primeira', { origem: 'sessao' })
    + linha('2026-09-29T10:10:00.000Z', 'deus', 'terceira'))
  const d = criarDaemon({ dados: mkdtempSync(join(tmpdir(), 'sle-ichat-d-')) })
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

const textos = `[...document.querySelectorAll('.msg .corpo')].map((e) => e.textContent.trim()).join('|')`

test('mensagem espelhada leva a marca "via VS Code"; a do proprio chat, nao', { skip: pular }, async () => {
  await browser.ir(`${base}/chat?poll=300`)
  await browser.esperar(`document.body.dataset.pronto === 'sim'`)
  assert.deepEqual(browser.erros, [])
  assert.equal(await browser.avaliar(`document.querySelectorAll('.msg .via').length`), 1)
  assert.equal(await browser.avaliar(`document.querySelector('.msg.diego .via').textContent`), 'via VS Code')
  assert.equal(await browser.avaliar(`document.querySelector('.msg.deus .via')`), null)
})

test('retardatario publicado depois entra no lugar do ts; o mais novo vai para o fim; um cabecalho de dia so', { skip: pular }, async () => {
  appendFileSync(arquivo, linha('2026-09-29T10:08:00.000Z', 'deus', 'segunda-atrasada', { origem: 'sessao' })
    + linha('2026-09-29T10:12:00.000Z', 'diego', 'quarta', { origem: 'sessao' }))
  await browser.esperar(`document.querySelectorAll('.msg').length === 4`, { limite: 8000 })
  assert.equal(await browser.avaliar(textos), 'primeira|segunda-atrasada|terceira|quarta')
  assert.equal(await browser.avaliar(`document.querySelectorAll('.dia').length`), 1)
  assert.equal(await browser.avaliar(`document.querySelectorAll('.msg .via').length`), 3)
})
