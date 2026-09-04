/**
 * O daemon da Fase 1: observar. Nada de escrita, nada de controle.
 *
 * `node:http` puro e zero dependencia -- numa ferramenta que fica no meio do
 * seu ambiente de trabalho, cada dependencia e superficie de ataque.
 */
import { createServer } from 'node:http'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import { Estado } from './estado.js'
import { normalizar } from './ingest.js'

const WEB = join(dirname(fileURLToPath(import.meta.url)), '..', 'web')

/** Servidos por nome, nunca por caminho vindo da URL. */
const ESTATICOS = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
  '/style.css': ['style.css', 'text/css; charset=utf-8'],
}

export function criarDaemon({ dados }) {
  const estado = new Estado(dados)
  const ouvintes = new Set()

  const servidor = createServer((req, res) => {
    const rota = req.url?.split('?')[0] ?? '/'

    if (req.method === 'POST' && rota === '/api/hook') return ingerir(req, res)
    if (rota === '/api/snapshot') return json(res, estado.snapshot())
    if (rota === '/api/stream') return abrirStream(res)

    const estatico = ESTATICOS[rota]
    if (estatico && req.method === 'GET') {
      const [arquivo, tipo] = estatico
      try {
        const corpo = readFileSync(join(WEB, arquivo))
        res.writeHead(200, { 'content-type': tipo })
        return res.end(corpo)
      } catch {
        return fim(res, 404)
      }
    }
    return fim(res, 404)
  })

  function ingerir(req, res) {
    let corpo = ''
    req.on('data', (c) => (corpo += c))
    req.on('end', () => {
      // Observar nunca derruba quem e observado: qualquer erro sai 204.
      try {
        const evento = normalizar(JSON.parse(corpo))
        if (evento) {
          estado.registrar(evento)
          transmitir(evento)
        }
      } catch {
        /* payload ruim e ignorado de proposito */
      }
      fim(res, 204)
    })
  }

  function abrirStream(res) {
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    })
    res.write(': conectado\n\n')
    ouvintes.add(res)
    res.on('close', () => ouvintes.delete(res))
  }

  function transmitir(evento) {
    const linha = `data: ${JSON.stringify(evento)}\n\n`
    for (const o of ouvintes) o.write(linha)
  }

  return { servidor, estado }
}

const json = (res, dados) => {
  res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(dados))
}
const fim = (res, codigo) => {
  res.writeHead(codigo)
  res.end()
}
