/**
 * Registro de push do celular (CARD-094): guarda a chave VAPID do servidor e os aparelhos que pediram
 * aviso. O DISPARO (assinar o JWT VAPID, cifrar o payload e mandar ao servico de push) e do CARD-240 e
 * usa este modulo: `loadVapid(dados)` da o par de chaves e `listSubscriptions(dados)` os aparelhos.
 *
 * Fica em `<dados>/push/` (o volume do console, que sobrevive a redeploy), com modo 0600: a chave
 * privada assina em nome do servidor. So endpoints de servicos de push conhecidos entram -- o
 * disparo faz um POST para o endpoint, e aceitar URL qualquer seria abrir um SSRF.
 */
import { generateKeyPairSync } from 'node:crypto'
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export const MAX_SUBSCRIPTIONS = 20
const MAX_ENDPOINT_LENGTH = 1000
/** FCM (Chrome/Android), Mozilla, Apple (iOS/Safari) e Windows (Edge). */
const PUSH_HOSTS = [/^fcm\.googleapis\.com$/, /(^|\.)push\.services\.mozilla\.com$/, /(^|\.)push\.apple\.com$/, /(^|\.)notify\.windows\.com$/]
const BASE64URL = /^[A-Za-z0-9_-]+$/

const dirOf = (dados) => join(dados, 'push')

function writePrivate(file, text) {
  const tmp = `${file}.${process.pid}.tmp`
  writeFileSync(tmp, text, { mode: 0o600 })
  renameSync(tmp, file)
}

/**
 * `{publicKey, privateKey}` em base64url (ponto P-256 nao comprimido de 65 bytes e o escalar de 32).
 * `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY` no ambiente fixam o par; sem elas nasce um e fica em disco.
 */
export function loadVapid(dados, env = process.env) {
  if (env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY) return { publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY }
  const file = join(dirOf(dados), 'vapid.json')
  try {
    const saved = JSON.parse(readFileSync(file, 'utf8'))
    if (saved.publicKey && saved.privateKey) return { publicKey: saved.publicKey, privateKey: saved.privateKey }
  } catch { /* primeira vez (ou arquivo ruim): gera abaixo */ }
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
  const pub = publicKey.export({ format: 'jwk' })
  const pair = {
    publicKey: Buffer.concat([Buffer.from([4]), Buffer.from(pub.x, 'base64url'), Buffer.from(pub.y, 'base64url')]).toString('base64url'),
    privateKey: privateKey.export({ format: 'jwk' }).d,
  }
  mkdirSync(dirOf(dados), { recursive: true })
  writePrivate(file, JSON.stringify({ ...pair, createdAt: new Date().toISOString() }))
  return pair
}

const fail = (error) => ({ ok: false, error })
const decodedLength = (value) => (typeof value === 'string' && BASE64URL.test(value) ? Buffer.from(value, 'base64url').length : -1)

/** O formato de `PushSubscription.toJSON()`: `{endpoint, keys: {p256dh, auth}}`. */
export function validateSubscription(raw) {
  const endpoint = raw?.endpoint
  if (typeof endpoint !== 'string' || endpoint.length > MAX_ENDPOINT_LENGTH) return fail('endpoint invalido')
  let url
  try {
    url = new URL(endpoint)
  } catch {
    return fail('endpoint invalido')
  }
  if (url.protocol !== 'https:' || url.port || url.username || !PUSH_HOSTS.some((re) => re.test(url.hostname))) return fail('endpoint de servico de push desconhecido')
  const { p256dh, auth } = raw.keys ?? {}
  if (decodedLength(p256dh) !== 65 || Buffer.from(p256dh, 'base64url')[0] !== 4) return fail('chave p256dh invalida')
  if (decodedLength(auth) !== 16) return fail('chave auth invalida')
  return { ok: true, subscription: { endpoint, keys: { p256dh, auth } } }
}

const fileOf = (dados) => join(dirOf(dados), 'subscriptions.json')

export function listSubscriptions(dados) {
  try {
    const list = JSON.parse(readFileSync(fileOf(dados), 'utf8'))
    return Array.isArray(list) ? list : []
  } catch {
    return []
  }
}

function writeSubscriptions(dados, list) {
  mkdirSync(dirOf(dados), { recursive: true })
  writePrivate(fileOf(dados), JSON.stringify(list, null, 2))
}

/** Grava (ou atualiza, pelo endpoint) um aparelho. Passou de 20, cai o mais antigo. */
export function saveSubscription(dados, raw, { label = '', userAgent = '' } = {}) {
  const checked = validateSubscription(raw)
  if (!checked.ok) return checked
  const now = new Date().toISOString()
  const list = listSubscriptions(dados)
  const at = list.findIndex((s) => s.endpoint === checked.subscription.endpoint)
  const entry = {
    ...checked.subscription,
    label: String(label).slice(0, 80),
    userAgent: String(userAgent).slice(0, 200),
    createdAt: at >= 0 ? list[at].createdAt : now,
    updatedAt: now,
  }
  if (at >= 0) list[at] = entry
  else list.push(entry)
  writeSubscriptions(dados, list.sort((a, b) => a.updatedAt.localeCompare(b.updatedAt)).slice(-MAX_SUBSCRIPTIONS))
  return { ok: true, subscription: entry }
}

/** `true` se havia o aparelho. */
export function removeSubscription(dados, endpoint) {
  const list = listSubscriptions(dados)
  const rest = list.filter((s) => s.endpoint !== endpoint)
  if (rest.length === list.length) return false
  writeSubscriptions(dados, rest)
  return true
}
