import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { listSubscriptions, loadVapid, removeSubscription, saveSubscription, validateSubscription } from '../src/push.js'

const b64url = (buf) => Buffer.from(buf).toString('base64url')
const p256dh = () => b64url(Buffer.concat([Buffer.from([4]), randomBytes(64)]))
const sub = (over = {}) => ({ endpoint: `https://fcm.googleapis.com/fcm/send/${randomBytes(8).toString('hex')}`, keys: { p256dh: p256dh(), auth: b64url(randomBytes(16)) }, ...over })
const dir = () => mkdtempSync(join(tmpdir(), 'sle-push-'))

test('loadVapid cria o par de chaves na primeira vez e devolve o mesmo depois (arquivo 0600)', () => {
  const d = dir()
  const a = loadVapid(d)
  const raw = Buffer.from(a.publicKey, 'base64url')
  assert.equal(raw.length, 65, 'ponto nao comprimido de P-256')
  assert.equal(raw[0], 4)
  assert.equal(Buffer.from(a.privateKey, 'base64url').length, 32)
  assert.deepEqual(loadVapid(d), a)
  assert.equal(statSync(join(d, 'push', 'vapid.json')).mode & 0o777, 0o600)
})

test('a chave publica vem do arquivo, e ha outra env para fixar o par (rotacao sem apagar arquivo)', () => {
  const d = dir()
  const fixed = loadVapid(dir())
  const b = loadVapid(d, { VAPID_PUBLIC_KEY: fixed.publicKey, VAPID_PRIVATE_KEY: fixed.privateKey })
  assert.equal(b.publicKey, fixed.publicKey)
})

test('validateSubscription aceita o formato do navegador e recusa o que nao e', () => {
  assert.equal(validateSubscription(sub()).ok, true)
  assert.equal(validateSubscription(sub({ endpoint: 'https://updates.push.services.mozilla.com/wpush/v2/abc' })).ok, true)
  assert.equal(validateSubscription(sub({ endpoint: 'https://web.push.apple.com/QW1' })).ok, true)
  for (const ruim of [
    null, {}, sub({ endpoint: 'http://fcm.googleapis.com/x' }), sub({ endpoint: 'https://127.0.0.1/x' }), sub({ endpoint: 'https://evil.example.com/fcm.googleapis.com' }),
    sub({ endpoint: 'https://fcm.googleapis.com.evil.io/x' }), sub({ keys: {} }), sub({ keys: { p256dh: 'curta', auth: b64url(randomBytes(16)) } }),
    sub({ keys: { p256dh: p256dh(), auth: 'x' } }), sub({ endpoint: `https://fcm.googleapis.com/${'a'.repeat(2000)}` }),
  ]) {
    assert.equal(validateSubscription(ruim).ok, false, JSON.stringify(ruim)?.slice(0, 80))
  }
})

test('saveSubscription grava, atualiza pelo endpoint e lista; removeSubscription tira', () => {
  const d = dir()
  const s = sub()
  const a = saveSubscription(d, s, { label: 'Android' })
  assert.equal(a.ok, true)
  saveSubscription(d, s, { label: 'Android de novo' })
  const lista = listSubscriptions(d)
  assert.equal(lista.length, 1)
  assert.equal(lista[0].label, 'Android de novo')
  assert.equal(lista[0].endpoint, s.endpoint)
  assert.deepEqual(lista[0].keys, s.keys)
  assert.ok(lista[0].createdAt)
  assert.equal(statSync(join(d, 'push', 'subscriptions.json')).mode & 0o777, 0o600)
  assert.equal(removeSubscription(d, s.endpoint), true)
  assert.deepEqual(listSubscriptions(d), [])
  assert.equal(removeSubscription(d, s.endpoint), false)
})

test('no maximo 20 aparelhos: o mais antigo cai quando entra o 21o', () => {
  const d = dir()
  const first = sub()
  saveSubscription(d, first, {})
  for (let i = 0; i < 20; i++) saveSubscription(d, sub(), {})
  const lista = listSubscriptions(d)
  assert.equal(lista.length, 20)
  assert.ok(!lista.some((x) => x.endpoint === first.endpoint))
})

test('arquivo corrompido nao derruba: lista vazia e o proximo save reescreve', () => {
  const d = dir()
  saveSubscription(d, sub(), {})
  writeFileCorrupt(d)
  assert.deepEqual(listSubscriptions(d), [])
  assert.equal(saveSubscription(d, sub(), {}).ok, true)
  assert.equal(listSubscriptions(d).length, 1)
  assert.doesNotThrow(() => JSON.parse(readFileSync(join(d, 'push', 'subscriptions.json'), 'utf8')))
})

import { writeFileSync } from 'node:fs'
function writeFileCorrupt(d) {
  writeFileSync(join(d, 'push', 'subscriptions.json'), '{ quebrado')
}
