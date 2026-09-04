/**
 * O daemon da Fase 1: observar. Nada de escrita, nada de controle.
 *
 * `node:http` puro e zero dependencia -- numa ferramenta que fica no meio do
 * seu ambiente de trabalho, cada dependencia e superficie de ataque.
 */
import { createServer } from 'node:http'
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import { Estado } from './estado.js'
import { normalizar } from './ingest.js'
import { indexarCards } from './cards.js'
import { diffDoArquivo, estadoDoGit, historico, prsAbertos } from './repo.js'
import { observarArvore } from './watcher.js'
import { conter, salvarArquivo } from './escrita.js'
import { testarComando } from './verificacao.js'
import { Runner } from './runner.js'
import { decidirGate } from './gates.js'

const WEB = join(dirname(fileURLToPath(import.meta.url)), '..', 'web')

/** Servidos por nome, nunca por caminho vindo da URL. */
const ESTATICOS = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
  '/style.css': ['style.css', 'text/css; charset=utf-8'],
}

export function criarDaemon({ dados, projeto = process.cwd(), tetoDiarioUsd = Infinity }) {
  const estado = new Estado(dados)
  const runner = new Runner(projeto, { tetoDiarioUsd })
  const ouvintes = new Set()

  // O disco e a verdade: quando ele muda, a tela sabe. Sem polling.
  const observador = observarArvore(projeto)
  observador.aoMudar((mudanca) =>
    transmitir({
      ts: new Date().toISOString(),
      kind: 'arquivo.mudou',
      loop: 'L3',
      card: null,
      agent: null,
      session: null,
      parent_agent: null,
      payload: mudanca,
    })
  )

  const servidor = createServer((req, res) => {
    const rota = req.url?.split('?')[0] ?? '/'

    if (req.method === 'POST' && rota === '/api/hook') return ingerir(req, res)
    if (req.method === 'PUT' && rota === '/api/file') return gravar(req, res)
    if (req.method === 'POST' && rota === '/api/gates/test') return verificar(req, res)
    if (req.method === 'POST' && rota === '/api/emergency-stop') {
      return runner.pararTudo().then((mortos) => json(res, { mortos }))
    }
    if (rota === '/api/agents' && req.method === 'GET') {
      return json(res, { agentes: runner.agentes(), ativos: runner.ativos(), gasto: runner.gasto() })
    }
    if (req.method === 'POST' && /^\/api\/agents\/[^/]+\/run$/.test(rota)) {
      const id = decodeURIComponent(rota.split('/')[3])
      return runner.iniciar(id).then((r) => {
        if (r.ok) return json(res, r)
        const codigo = /nao existe/i.test(r.erro) ? 404 : 409
        res.writeHead(codigo, { 'content-type': 'application/json; charset=utf-8' })
        res.end(JSON.stringify(r))
      })
    }
    if (rota === '/api/gates' && req.method === 'GET') return json(res, lerGates())
    if (req.method === 'POST' && /^\/api\/gates\/[^/]+\/decide$/.test(rota)) {
      const id = decodeURIComponent(rota.split('/')[3])
      const gate = (lerGates().gates ?? []).find((g) => g.id === id)
      if (!gate) return fim(res, 404)
      return lerCorpo(req, async (corpo) => {
        let card = {}
        try {
          card = JSON.parse(corpo).card ?? {}
        } catch {
          /* card vazio decide pelo modo do gate */
        }
        json(res, await decidirGate(projeto, gate, card))
      })
    }
    if (req.method === 'GET' && rota === '/api/dir') {
      const pasta = new URL(req.url, 'http://x').searchParams.get('path') ?? ''
      const contido = conter(projeto, join(pasta, 'x'))
      if (!contido.ok) return json(res, { erro: contido.erro, arquivos: [] })
      try {
        const nomes = readdirSync(join(projeto, pasta)).filter((n) => !n.startsWith('.'))
        return json(res, { arquivos: nomes.map((n) => `${pasta}/${n}`) })
      } catch {
        return json(res, { arquivos: [] })
      }
    }
    if (req.method === 'GET' && rota === '/api/file') {
      const caminho = new URL(req.url, 'http://x').searchParams.get('path') ?? ''
      const contido = conter(projeto, caminho)
      if (!contido.ok) return json(res, { erro: contido.erro })
      try {
        return json(res, { caminho, conteudo: readFileSync(contido.absoluto, 'utf8') })
      } catch (e) {
        return json(res, { erro: e.message })
      }
    }
    if (rota === '/api/snapshot') {
      const indice = indexarCards(projeto)
      return json(res, {
        ...estado.snapshot(),
        cards: indice.cards,
        board: indice.board,
        divergencias: indice.divergencias,
        git: estadoDoGit(projeto),
      })
    }
    if (rota === '/api/cards') return json(res, indexarCards(projeto))
    if (rota.startsWith('/api/cards/')) {
      const id = decodeURIComponent(rota.slice('/api/cards/'.length))
      const achado = indexarCards(projeto).cards.find((c) => c.id === id)
      return achado ? json(res, achado) : fim(res, 404)
    }
    if (rota === '/api/git/tree') return json(res, estadoDoGit(projeto))
    if (rota === '/api/git/log') return json(res, historico(projeto))
    if (rota === '/api/git/diff') {
      const arquivo = new URL(req.url, 'http://x').searchParams.get('file') ?? ''
      return json(res, { arquivo, diff: diffDoArquivo(projeto, arquivo) })
    }
    if (rota === '/api/prs') return json(res, prsAbertos(projeto))
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

  function lerGates() {
    try {
      return JSON.parse(readFileSync(join(projeto, 'sle', 'gates', 'pipeline.json'), 'utf8'))
    } catch {
      return { stages: [], gates: [] }
    }
  }

  function gravar(req, res) {
    lerCorpo(req, (corpo) => {
      const caminho = new URL(req.url, 'http://x').searchParams.get('path') ?? ''
      const r = salvarArquivo(projeto, caminho, corpo)
      if (r.ok) return json(res, r)
      // 403 para caminho recusado, 422 para conteudo invalido: sao problemas
      // diferentes e quem chama precisa saber qual dos dois foi.
      const codigo = /projeto|pasta|\.git/i.test(r.erro) ? 403 : 422
      res.writeHead(codigo, { 'content-type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify(r))
    })
  }

  function verificar(req, res) {
    lerCorpo(req, async (corpo) => {
      let pedido = {}
      try {
        pedido = JSON.parse(corpo)
      } catch {
        /* comando vazio cai na validacao de testarComando */
      }
      json(res, await testarComando(projeto, pedido.comando ?? ''))
    })
  }

  function lerCorpo(req, pronto) {
    let corpo = ''
    req.on('data', (c) => (corpo += c))
    req.on('end', () => pronto(corpo))
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

  return { servidor, estado, observador, runner }
}

const json = (res, dados) => {
  res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(dados))
}
const fim = (res, codigo) => {
  res.writeHead(codigo)
  res.end()
}
