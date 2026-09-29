/**
 * Rotas do chat (`/api/chat*`), fora do daemon.js para nao crescer o arquivo
 * que outros cards tambem editam. `raiz` e onde mora `chat/`: o clone em modo
 * git, o checkout do 00-DEUS no console local.
 */
import { relative } from 'node:path'

import { acrescentar, buscar, desde, pagina } from './chat.js'
import { commitAndPush } from './gitSync.js'

const LIMITE_CORPO = 64 * 1024

const json = (res, dados, codigo = 200) => {
  res.writeHead(codigo, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(JSON.stringify(dados))
}

function lerCorpo(req, cb) {
  let corpo = ''
  let estourou = false
  req.on('data', (c) => {
    corpo += c
    if (corpo.length > LIMITE_CORPO) {
      estourou = true
      corpo = ''
    }
  })
  req.on('end', () => cb(estourou ? null : corpo))
}

/** Devolve `(req, res, rota) => boolean` (true = tratou a requisicao). */
export function criarRotasChat({ raiz, git = null, registrar = () => {}, avisar = () => {} }) {
  function enviar(req, res) {
    lerCorpo(req, (corpo) => {
      let texto = ''
      try {
        texto = JSON.parse(corpo ?? '').texto
      } catch {
        /* corpo invalido cai em texto vazio */
      }
      if (corpo === null) return json(res, { erro: 'mensagem grande demais' }, 413)
      const r = acrescentar(raiz, { de: 'diego', texto })
      if (!r.ok) return json(res, { erro: r.erro }, r.codigo)
      let sync = { ok: true }
      if (git) {
        sync = commitAndPush({
          dataDir: git.dataDir,
          keyPath: git.keyPath,
          paths: [relative(git.dataDir, `${raiz}/${r.arquivo}`)],
          message: `chat: mensagem do Diego (${r.mensagem.id})`,
        })
        if (!sync.ok) {
          registrar({ kind: 'git.push.falhou', loop: 'L3', card: null, session: null, payload: { erro: sync.stderr } })
        }
      }
      avisar(r.mensagem)
      const resposta = { ok: true, mensagem: r.mensagem }
      if (!sync.ok) resposta.sync = 'pendente'
      return json(res, resposta)
    })
    return true
  }

  return function tratar(req, res, rota) {
    if (rota === '/api/chat' && req.method === 'POST') return enviar(req, res)
    if (rota !== '/api/chat' || req.method !== 'GET') return false
    const q = new URL(req.url, 'http://x').searchParams
    if (q.get('q')) return json(res, { mensagens: buscar(raiz, q.get('q')) }), true
    if (q.get('desde')) return json(res, { mensagens: desde(raiz, q.get('desde')) }), true
    const dias = Math.min(Math.max(Number(q.get('dias')) || 2, 1), 30)
    return json(res, pagina(raiz, { antes: q.get('antes'), dias })), true
  }
}
