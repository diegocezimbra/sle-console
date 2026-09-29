import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { criarDaemon } from '../src/daemon.js'
import { ensureCloned } from '../src/gitSync.js'
import { abrirBrowser, acharChrome } from './apoio/browser.js'

const chrome = await acharChrome()
const pular = chrome ? false : 'sem Chrome nesta maquina'
const git = (args, cwd) => {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' })
  assert.equal(r.status, 0, r.stderr)
  return r.stdout
}
const post = (base, texto) => fetch(`${base}/api/chat`, { method: 'POST', body: JSON.stringify({ texto }) })

async function subir(opcoes = {}) {
  const d = criarDaemon({ dados: mkdtempSync(join(tmpdir(), 'sle-cd-')), ...opcoes })
  await new Promise((r) => d.servidor.listen(0, '127.0.0.1', r))
  return {
    base: `http://127.0.0.1:${d.servidor.address().port}`,
    fechar: () => new Promise((r) => {
      d.observador.parar(); d.pararGit(); d.servidor.closeAllConnections(); d.servidor.close(r)
    }),
  }
}

let dir, s, browser
before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'sle-chatdir-'))
  process.env.CONSOLE_CHAT_DIR = dir
  mkdirSync(join(dir, 'chat'))
  writeFileSync(join(dir, 'chat', '2026-09-28.jsonl'),
    JSON.stringify({ ts: '2026-09-28T12:00:00.000Z', de: 'deus', texto: 'ontem: **negrito**', id: 'x1' }) + '\n')
  s = await subir()
  if (chrome) browser = await abrirBrowser()
})
after(async () => {
  delete process.env.CONSOLE_CHAT_DIR
  await browser?.fechar()
  await s?.fechar()
})

test('POST /api/chat grava como Diego e GET devolve a thread', async () => {
  const r = await post(s.base, 'olá **DEUS**')
  assert.equal(r.status, 200)
  const { mensagem } = await r.json()
  assert.equal(mensagem.de, 'diego')
  const { mensagens } = await (await fetch(`${s.base}/api/chat?dias=5`)).json()
  assert.ok(mensagens.some((x) => x.id === mensagem.id))
  assert.equal(mensagens[0].texto, 'ontem: **negrito**')
})

test('POST recusa segredo, vazio e corpo enorme', async () => {
  assert.equal((await post(s.base, 'ghp_' + 'z'.repeat(30))).status, 422)
  assert.equal((await post(s.base, '  ')).status, 422)
  assert.equal((await post(s.base, 'x'.repeat(70_000))).status, 413)
})

test('busca e desde funcionam pela API', async () => {
  const b = await (await fetch(`${s.base}/api/chat?q=NEGRITO`)).json()
  assert.equal(b.mensagens.length, 1)
  const d = await (await fetch(`${s.base}/api/chat?desde=2026-09-28T12:00:00.000Z`)).json()
  assert.ok(d.mensagens.every((x) => x.ts > '2026-09-28T12:00:00.000Z'))
})

test('/chat serve a pagina e os assets', async () => {
  for (const [rota, tipo] of [['/chat', 'text/html'], ['/chat.js', 'javascript'], ['/chat.css', 'text/css'], ['/chat-md.js', 'javascript']]) {
    const r = await fetch(`${s.base}${rota}`)
    assert.equal(r.status, 200, rota)
    assert.match(r.headers.get('content-type'), new RegExp(tipo))
  }
})

test('modo git: cada mensagem do Diego vira commit empurrado ao remoto', async () => {
  const remoto = mkdtempSync(join(tmpdir(), 'sle-cr-'))
  git(['init', '--bare', '-b', 'main', remoto])
  const seed = mkdtempSync(join(tmpdir(), 'sle-cs-'))
  git(['init', '-b', 'main', seed])
  for (const [k, v] of [['user.email', 's@x'], ['user.name', 's']]) git(['config', k, v], seed)
  mkdirSync(join(seed, 'cards', 'doing'), { recursive: true })
  writeFileSync(join(seed, 'cards', 'doing', '.keep'), '')
  git(['add', 'cards'], seed); git(['commit', '-m', 'seed'], seed)
  git(['remote', 'add', 'origin', remoto], seed); git(['push', 'origin', 'main'], seed)
  const dataDir = join(mkdtempSync(join(tmpdir(), 'sle-cc-')), '00-deus')
  ensureCloned({ repoUrl: remoto, dataDir, keyPath: '/dev/null', branch: 'main' })
  for (const [k, v] of [['user.email', 'c@x'], ['user.name', 'c']]) git(['config', k, v], dataDir)
  delete process.env.CONSOLE_CHAT_DIR
  const g = await subir({ projeto: dataDir, raiz: [dataDir], git: { dataDir, keyPath: '/dev/null', intervalMs: 3_600_000 } })
  process.env.CONSOLE_CHAT_DIR = dir
  try {
    const r = await post(g.base, 'mensagem pelo git')
    assert.equal(r.status, 200)
    assert.equal((await r.json()).sync, undefined)
    const dia = new Date().toISOString().slice(0, 10)
    assert.match(git(['show', `main:chat/${dia}.jsonl`], remoto), /mensagem pelo git/)
    assert.match(git(['log', '-1', '--format=%s', 'main'], remoto), /^chat: mensagem do Diego/)
  } finally {
    await g.fechar()
  }
})

test('mobile: a pagina monta, envia com Enter, Shift+Enter nao envia, busca filtra', { skip: pular }, async () => {
  await browser.viewport(390, 800)
  await browser.ir(`${s.base}/chat`)
  await browser.esperar(`document.body.dataset.pronto === 'sim'`)
  assert.deepEqual(browser.erros, [])
  assert.equal(await browser.avaliar(`document.documentElement.scrollWidth <= 390`), true, 'sem rolagem horizontal')
  assert.equal(await browser.avaliar(`document.querySelector('.msg strong')?.textContent`), 'negrito')
  const alvo = await browser.avaliar(`(() => { const t = document.getElementById('texto'); t.value = 'pelo navegador';
    t.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true, cancelable: true }));
    return document.querySelectorAll('.msg.diego').length })()`)
  assert.equal(alvo, 1, 'Shift+Enter nao envia (so a mensagem de antes existe)')
  await browser.avaliar(`document.getElementById('texto').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))`)
  await browser.esperar(`[...document.querySelectorAll('.msg.diego')].some((e) => e.textContent.includes('pelo navegador'))`)
  await browser.avaliar(`(() => { const b = document.getElementById('busca'); b.value = 'negrito'; b.dispatchEvent(new Event('input')) })()`)
  await browser.esperar(`document.querySelectorAll('.msg').length === 1`)
})
