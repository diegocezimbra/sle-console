/**
 * Rotas do registro de push (CARD-094), fora do daemon.js:
 *
 *   GET  /api/push/key          a chave publica VAPID (o navegador precisa dela para assinar)
 *   POST /api/push/subscribe    {subscription, label}: guarda o aparelho
 *   POST /api/push/unsubscribe  {endpoint}: tira o aparelho
 */
import { listSubscriptions, loadVapid, removeSubscription, saveSubscription } from './push.js'

const BODY_LIMIT = 8 * 1024

const json = (res, dados, codigo = 200) => {
  res.writeHead(codigo, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(JSON.stringify(dados))
}

function readBody(req, cb) {
  let body = ''
  let overflowed = false
  req.on('data', (c) => {
    if (overflowed) return
    body += c
    if (body.length > BODY_LIMIT) {
      overflowed = true
      body = ''
    }
  })
  req.on('end', () => cb(overflowed ? null : body))
}

const parse = (body) => {
  try {
    return JSON.parse(body) ?? {}
  } catch {
    return {}
  }
}

/** Devolve `(req, res, rota) => boolean` (true = tratou). `dados` e o volume do console. */
export function createPushRoutes({ dados }) {
  return function handle(req, res, rota) {
    if (rota === '/api/push/key' && req.method === 'GET') {
      json(res, { publicKey: loadVapid(dados).publicKey })
      return true
    }
    if (req.method !== 'POST' || (rota !== '/api/push/subscribe' && rota !== '/api/push/unsubscribe')) return false
    readBody(req, (body) => {
      if (body === null) return json(res, { erro: 'corpo grande demais' }, 413)
      const pedido = parse(body)
      if (rota === '/api/push/unsubscribe') return json(res, { ok: true, removed: removeSubscription(dados, String(pedido.endpoint ?? '')) })
      const r = saveSubscription(dados, pedido.subscription, { label: pedido.label, userAgent: req.headers['user-agent'] })
      if (!r.ok) return json(res, { erro: r.error }, 422)
      return json(res, { ok: true, devices: listSubscriptions(dados).length })
    })
    return true
  }
}
