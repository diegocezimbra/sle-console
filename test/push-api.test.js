import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { criarDaemon } from '../src/daemon.js'
import { listSubscriptions } from '../src/push.js'

const b64url = (buf) => Buffer.from(buf).toString('base64url')
const sub = () => ({ endpoint: `https://fcm.googleapis.com/fcm/send/${randomBytes(8).toString('hex')}`, keys: { p256dh: b64url(Buffer.concat([Buffer.from([4]), randomBytes(64)])), auth: b64url(randomBytes(16)) } })
let base, fechar, dados

before(async () => {
  dados = mkdtempSync(join(tmpdir(), 'sle-papi-'))
  const d = criarDaemon({ dados })
  await new Promise((r) => d.servidor.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${d.servidor.address().port}`
  fechar = () => new Promise((r) => (d.observador.parar(), d.servidor.closeAllConnections(), d.servidor.close(r)))
})
after(async () => { await fechar?.() })

const post = (rota, corpo) => fetch(base + rota, { method: 'POST', body: JSON.stringify(corpo), headers: { 'user-agent': 'Mozilla/5.0 (Linux; Android 15) Chrome/150' } })

test('GET /api/push/key devolve a chave publica VAPID (a mesma nas proximas chamadas)', async () => {
  const a = await (await fetch(`${base}/api/push/key`)).json()
  assert.equal(Buffer.from(a.publicKey, 'base64url').length, 65)
  assert.deepEqual(await (await fetch(`${base}/api/push/key`)).json(), a)
})

test('POST /api/push/subscribe guarda o aparelho (com o user-agent) e unsubscribe tira', async () => {
  const s = sub()
  const r = await post('/api/push/subscribe', { subscription: s, label: 'Meu celular' })
  assert.equal(r.status, 200)
  assert.equal((await r.json()).ok, true)
  const [saved] = listSubscriptions(dados)
  assert.equal(saved.endpoint, s.endpoint)
  assert.equal(saved.label, 'Meu celular')
  assert.match(saved.userAgent, /Android/)
  const out = await post('/api/push/unsubscribe', { endpoint: s.endpoint })
  assert.equal(out.status, 200)
  assert.equal((await out.json()).removed, true)
  assert.deepEqual(listSubscriptions(dados), [])
})

test('recusa endpoint de fora dos servicos de push, corpo ruim e corpo enorme', async () => {
  assert.equal((await post('/api/push/subscribe', { subscription: { ...sub(), endpoint: 'https://evil.example.com/x' } })).status, 422)
  assert.equal((await post('/api/push/subscribe', { subscription: null })).status, 422)
  assert.equal((await fetch(`${base}/api/push/subscribe`, { method: 'POST', body: 'nao e json' })).status, 422)
  assert.equal((await fetch(`${base}/api/push/subscribe`, { method: 'POST', body: 'x'.repeat(20_000) })).status, 413)
  assert.equal((await fetch(`${base}/api/push/subscribe`)).status, 404, 'so POST')
})
