import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { criarDaemon } from '../src/daemon.js'
import { createAuthMiddleware } from '../src/auth.js'

async function subir(env) {
  const previous = { user: process.env.CONSOLE_USER, password: process.env.CONSOLE_PASSWORD }
  if (env.CONSOLE_USER === undefined) delete process.env.CONSOLE_USER
  else process.env.CONSOLE_USER = env.CONSOLE_USER
  if (env.CONSOLE_PASSWORD === undefined) delete process.env.CONSOLE_PASSWORD
  else process.env.CONSOLE_PASSWORD = env.CONSOLE_PASSWORD

  const d = criarDaemon({ dados: mkdtempSync(join(tmpdir(), 'sle-auth-')) })
  await new Promise((r) => d.servidor.listen(0, '127.0.0.1', r))
  const base = `http://127.0.0.1:${d.servidor.address().port}`
  const fechar = () =>
    new Promise((r) => {
      d.observador.parar()
      d.servidor.closeAllConnections()
      d.servidor.close(r)
      if (previous.user === undefined) delete process.env.CONSOLE_USER
      else process.env.CONSOLE_USER = previous.user
      if (previous.password === undefined) delete process.env.CONSOLE_PASSWORD
      else process.env.CONSOLE_PASSWORD = previous.password
    })
  return { base, fechar }
}

test('senha errada devolve 401 com WWW-Authenticate', async () => {
  const { base, fechar } = await subir({ CONSOLE_USER: 'deus', CONSOLE_PASSWORD: 'segredo' })
  const auth = Buffer.from('deus:errada').toString('base64')
  const r = await fetch(`${base}/api/cards`, { headers: { authorization: `Basic ${auth}` } })
  assert.equal(r.status, 401)
  assert.match(r.headers.get('www-authenticate') ?? '', /Basic/)
  await fechar()
})

test('sem header nenhum devolve 401', async () => {
  const { base, fechar } = await subir({ CONSOLE_USER: 'deus', CONSOLE_PASSWORD: 'segredo' })
  const r = await fetch(`${base}/api/cards`)
  assert.equal(r.status, 401)
  await fechar()
})

test('senha certa devolve 200', async () => {
  const { base, fechar } = await subir({ CONSOLE_USER: 'deus', CONSOLE_PASSWORD: 'segredo' })
  const auth = Buffer.from('deus:segredo').toString('base64')
  const r = await fetch(`${base}/api/cards`, { headers: { authorization: `Basic ${auth}` } })
  assert.equal(r.status, 200)
  await fechar()
})

test('sem CONSOLE_USER/CONSOLE_PASSWORD, libera sem auth (modo local)', async () => {
  const { base, fechar } = await subir({ CONSOLE_USER: undefined, CONSOLE_PASSWORD: undefined })
  const r = await fetch(`${base}/api/cards`)
  assert.equal(r.status, 200)
  await fechar()
})

test('createAuthMiddleware compara em tempo constante mesmo com tamanhos diferentes', () => {
  const authorize = createAuthMiddleware({ CONSOLE_USER: 'deus', CONSOLE_PASSWORD: 'senha-longa-123' })
  const calls = []
  const res = {
    writeHead: (status, headers) => calls.push(['writeHead', status, headers]),
    end: (body) => calls.push(['end', body]),
  }
  const auth = Buffer.from('deus:x').toString('base64')
  const ok = authorize({ headers: { authorization: `Basic ${auth}` } }, res)
  assert.equal(ok, false)
  assert.equal(calls[0][1], 401)
})

// CARD-094: o navegador busca manifesto, service worker e icones SEM credencial (o <link rel=manifest> usa
// credentials=omit; o iOS busca o apple-touch-icon sozinho). Sao arquivos estaticos sem dado nenhum.
test('manifest, service worker e icones sao publicos; o resto continua atras da senha', async () => {
  const { base, fechar } = await subir({ CONSOLE_USER: 'deus', CONSOLE_PASSWORD: 'segredo' })
  try {
    for (const rota of ['/manifest.json', '/sw.js', '/icons/icon-192.png', '/icons/apple-touch-icon.png']) {
      assert.equal((await fetch(base + rota)).status, 200, rota)
    }
    for (const rota of ['/', '/chat', '/app.js', '/mobile/shell.js', '/api/cards', '/api/push/key', '/icons/../app.js']) {
      assert.equal((await fetch(base + rota)).status, 401, rota)
    }
  } finally {
    await fechar()
  }
})
