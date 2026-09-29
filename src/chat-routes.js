/**
 * Rotas do chat (`/api/chat*`), fora do daemon.js para nao crescer o arquivo
 * que outros cards tambem editam. `root` e onde mora `chat/`: o clone em modo
 * git, o checkout do 00-DEUS no console local.
 *
 *   POST /api/chat                           mensagem de texto (ate 64 KB)
 *   POST /api/chat/attachments               texto + ate 4 imagens em base64 (ate 8 MB) -- CARD-094
 *   GET  /api/chat/anexos/<dia>/<arquivo>    a imagem de uma mensagem (so os nomes que o servidor gera)
 */
import { existsSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'

import { append, search, since, page } from './chat.js'
import { ATTACHMENT_BODY_LIMIT, SERVED_EXTENSIONS, contentTypeOf, decodeAttachments, dispositionOf } from './chat-attachments.js'
import { commitAndPush } from './gitSync.js'

const BODY_LIMIT = 64 * 1024
const ATTACHMENT_FILE = new RegExp(`^/api/chat/anexos/(\\d{4}-\\d{2}-\\d{2})/([\\w-]+\\.(?:${SERVED_EXTENSIONS.join('|')}))$`)
const ONE_YEAR_S = 31_536_000

const json = (res, dados, codigo = 200) => {
  res.writeHead(codigo, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(JSON.stringify(dados))
}

function readBody(req, limit, cb) {
  let body = ''
  let overflowed = false
  req.on('data', (c) => {
    if (overflowed) return
    body += c
    if (body.length > limit) {
      overflowed = true
      body = ''
    }
  })
  req.on('end', () => cb(overflowed ? null : body))
}

/** Devolve `(req, res, rota) => boolean` (true = tratou a requisicao). */
export function createChatRoutes({ root, git = null, registrar = () => {}, avisar = () => {} }) {
  /** Grava (o `append` ja gravou no disco), empurra para o git quando e o caso e responde. */
  function finish(res, r) {
    let sync = { ok: true }
    if (git) {
      sync = commitAndPush({
        dataDir: git.dataDir,
        keyPath: git.keyPath,
        paths: (r.paths ?? [r.file]).map((path) => relative(git.dataDir, `${root}/${path}`)),
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
  }

  function parseJson(body) {
    try {
      return JSON.parse(body ?? '')
    } catch {
      return {}
    }
  }

  function send(req, res) {
    readBody(req, BODY_LIMIT, (body) => {
      const texto = parseJson(body).texto
      if (body === null) return json(res, { erro: 'mensagem grande demais' }, 413)
      // O Diego digitando um segredo: aceita e AVISA (o DEUS nao repete); quem recusa e o `deus chat enviar`.
      const r = append(root, { de: 'diego', texto })
      if (!r.ok) return json(res, { erro: r.error }, r.code)
      return finish(res, r)
    })
    return true
  }

  function sendWithAttachments(req, res) {
    readBody(req, ATTACHMENT_BODY_LIMIT, (body) => {
      if (body === null) return json(res, { erro: 'corpo acima de 8 MB' }, 413)
      const pedido = parseJson(body)
      const decoded = decodeAttachments(pedido.anexos)
      if (!decoded.ok) return json(res, { erro: decoded.error }, decoded.code)
      const r = append(root, { de: 'diego', texto: pedido.texto, files: decoded.files })
      if (!r.ok) return json(res, { erro: r.error }, r.code)
      return finish(res, r)
    })
    return true
  }

  /**
   * So os nomes que o servidor (ou `deus chat enviar --arquivo`) gera (`<id>-<n>.<ext>`): o padrao da rota ja nao deixa passar `..` nem barra.
   * Imagem abre na pagina; o resto e download com o nome de `?nome=` (o que o DEUS enviou), sempre atras da autenticacao do console.
   */
  function serveAttachment(req, res, dia, nome) {
    const file = join(root, 'chat', 'anexos', dia, nome)
    if (!existsSync(file)) {
      res.writeHead(404)
      res.end()
      return true
    }
    res.writeHead(200, {
      'content-type': contentTypeOf(nome),
      'content-disposition': dispositionOf(nome, new URL(req.url, 'http://x').searchParams.get('nome')),
      // O nome tem o id da mensagem: o conteudo nunca muda, entao o navegador pode guardar para sempre.
      'cache-control': `private, max-age=${ONE_YEAR_S}, immutable`,
      'x-content-type-options': 'nosniff',
      'content-security-policy': "default-src 'none'; sandbox",
    })
    res.end(readFileSync(file))
    return true
  }

  return function handle(req, res, rota) {
    if (rota === '/api/chat' && req.method === 'POST') return send(req, res)
    if (rota === '/api/chat/attachments' && req.method === 'POST') return sendWithAttachments(req, res)
    const anexo = req.method === 'GET' ? ATTACHMENT_FILE.exec(rota) : null
    if (anexo) return serveAttachment(req, res, anexo[1], anexo[2])
    if (rota !== '/api/chat' || req.method !== 'GET') return false
    const q = new URL(req.url, 'http://x').searchParams
    if (q.get('q')) return json(res, { mensagens: search(root, q.get('q')) }), true
    if (q.get('desde')) return json(res, { mensagens: since(root, q.get('desde')) }), true
    const dias = Math.min(Math.max(Number(q.get('dias')) || 2, 1), 30)
    return json(res, page(root, { antes: q.get('antes'), dias })), true
  }
}
