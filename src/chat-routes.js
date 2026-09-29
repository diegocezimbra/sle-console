/**
 * Rotas do chat (`/api/chat*`), fora do daemon.js para nao crescer o arquivo
 * que outros cards tambem editam. `root` e onde mora `chat/`: o clone em modo
 * git, o checkout do 00-DEUS no console local.
 */
import { relative } from 'node:path'

import { append, search, since, page } from './chat.js'
import { commitAndPush } from './gitSync.js'

const BODY_LIMIT = 64 * 1024

const json = (res, dados, codigo = 200) => {
  res.writeHead(codigo, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(JSON.stringify(dados))
}

function readBody(req, cb) {
  let body = ''
  let overflowed = false
  req.on('data', (c) => {
    body += c
    if (body.length > BODY_LIMIT) {
      overflowed = true
      body = ''
    }
  })
  req.on('end', () => cb(overflowed ? null : body))
}

/** Devolve `(req, res, rota) => boolean` (true = tratou a requisicao). */
export function createChatRoutes({ root, git = null, registrar = () => {}, avisar = () => {} }) {
  function send(req, res) {
    readBody(req, (body) => {
      let texto = ''
      try {
        texto = JSON.parse(body ?? '').texto
      } catch {
        /* body invalido cai em texto vazio */
      }
      if (body === null) return json(res, { erro: 'mensagem grande demais' }, 413)
      // O Diego digitando um segredo: aceita e AVISA (o DEUS nao repete); quem recusa e o `deus chat enviar`.
      const r = append(root, { de: 'diego', texto })
      if (!r.ok) return json(res, { erro: r.error }, r.code)
      let sync = { ok: true }
      if (git) {
        sync = commitAndPush({
          dataDir: git.dataDir,
          keyPath: git.keyPath,
          paths: [relative(git.dataDir, `${root}/${r.file}`)],
          message: `chat: mensagem do Diego (${r.message.id})`,
        })
        if (!sync.ok) {
          registrar({ kind: 'git.push.falhou', loop: 'L3', card: null, session: null, payload: { erro: sync.stderr } })
        }
      }
      avisar(r.message)
      const reply = { ok: true, mensagem: r.message, ...(r.warning && { aviso: r.warning }) }
      if (!sync.ok) reply.sync = 'pendente'
      return json(res, reply)
    })
    return true
  }

  return function handle(req, res, rota) {
    if (rota === '/api/chat' && req.method === 'POST') return send(req, res)
    if (rota !== '/api/chat' || req.method !== 'GET') return false
    const q = new URL(req.url, 'http://x').searchParams
    if (q.get('q')) return json(res, { mensagens: search(root, q.get('q')) }), true
    if (q.get('desde')) return json(res, { mensagens: since(root, q.get('desde')) }), true
    const dias = Math.min(Math.max(Number(q.get('dias')) || 2, 1), 30)
    return json(res, page(root, { antes: q.get('antes'), dias })), true
  }
}
