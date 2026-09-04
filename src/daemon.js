/**
 * O daemon da Fase 1: observar. Nada de escrita, nada de controle.
 *
 * `node:http` puro e zero dependencia -- numa ferramenta que fica no meio do
 * seu ambiente de trabalho, cada dependencia e superficie de ataque.
 */
import { createServer } from 'node:http'
import { readdirSync, readFileSync, renameSync, mkdirSync, writeFileSync } from 'node:fs'
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
import { calcularMetricas } from './metricas.js'
import { montarHistorico } from './historico.js'
import { extrairMedidas } from './otel.js'
import { COLUNAS, lerCard } from './cards.js'
import { descobrirProjetos, resolverProjeto } from './projetos.js'
import { gitDeTodos, indexarTodos, TODOS } from './agregado.js'

const WEB = join(dirname(fileURLToPath(import.meta.url)), '..', 'web')

/** Servidos por nome, nunca por caminho vindo da URL. */
const ESTATICOS = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
  '/style.css': ['style.css', 'text/css; charset=utf-8'],
}

/**
 * `raiz` e a arvore que contem varios projetos; `projeto` e o padrao.
 * Toda rota de leitura aceita `?projeto=`, validado contra a arvore.
 */
export function criarDaemon({ dados, projeto = process.cwd(), raiz = null, tetoDiarioUsd = Infinity }) {
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
    // Projeto por requisicao: a tela troca de projeto sem reiniciar o daemon.
    const pedido = new URL(req.url, 'http://x').searchParams.get('projeto')
    // `*` é a visão de todos: não resolve para um caminho.
    const todos = pedido === TODOS && raiz != null
    const alvo = todos ? null : raiz ? resolverProjeto(raiz, pedido ?? projeto) : projeto
    const indice = () => (todos ? indexarTodos(raiz) : indexarCards(alvo))
    // Ler cards e git funciona agregado; abrir arquivo, rodar agente ou pedir
    // diff exige saber QUAL projeto. Sem isso o daemon receberia `null` e
    // morreria -- e daemon que cai leva a tela junto.
    const exigeProjeto = () => {
      if (!todos) return false
      res.writeHead(409, { 'content-type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify({ erro: 'escolha um projeto no seletor para esta ação' }))
      return true
    }
    const git = () => (todos ? gitDeTodos(raiz) : estadoDoGit(alvo))

    if (rota === '/api/projetos') {
      return json(res, {
        raiz,
        atual: todos ? TODOS : alvo,
        todos: TODOS,
        projetos: raiz ? descobrirProjetos(raiz) : [],
      })
    }

    if (req.method === 'POST' && rota === '/api/hook') return ingerir(req, res)
    if (req.method === 'PUT' && rota === '/api/file') {
      // Escrever exige saber em qual projeto: a visão de todos é só leitura.
      if (exigeProjeto()) return
      return gravar(req, res)
    }
    if (req.method === 'POST' && rota === '/api/gates/test') return verificar(req, res)
    if (req.method === 'POST' && rota === '/api/emergency-stop') {
      return runner.pararTudo().then((mortos) => json(res, { mortos }))
    }
    if (rota === '/api/agents' && req.method === 'GET') {
      if (exigeProjeto()) return
      // `ativos` sao processos que o console lancou; `sessoes` sao as que ele
      // observa. Mostrar so os primeiros faz a tela dizer "nenhum agente
      // rodando" enquanto cinco sessoes trabalham.
      return json(res, {
        agentes: runner.agentes(alvo),
        ativos: runner.ativos(),
        sessoes: estado.snapshot().sessoes.filter((x) => x.ativa),
        gasto: runner.gasto(),
      })
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
    if (rota === '/api/historico' && req.method === 'GET') {
      const q = new URL(req.url, 'http://x').searchParams
      return json(res, montarHistorico(estado.todos(), { de: q.get('de'), ate: q.get('ate') }))
    }
    if (rota === '/api/metrics' && req.method === 'GET') {
      return json(res, calcularMetricas(estado.todos()))
    }
    if (req.method === 'POST' && /^\/api\/cards\/[^/]+\/move$/.test(rota)) {
      const id = decodeURIComponent(rota.split('/')[3])
      return lerCorpo(req, (corpo) => moverCard(id, corpo, res))
    }
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
        const decisao = await decidirGate(projeto, gate, card)
        // A decisao vira evento: sem isso as metricas nao teriam o que medir.
        registrar({
          kind: 'gate.decidido',
          loop: 'L3',
          card: card.id ?? null,
          session: null,
          payload: { ...decisao, card: card.id ?? null },
        })
        json(res, decisao)
      })
    }
    if (req.method === 'GET' && rota === '/api/dir') {
      if (exigeProjeto()) return
      const pasta = new URL(req.url, 'http://x').searchParams.get('path') ?? ''
      const contido = conter(alvo, join(pasta, 'x'))
      if (!contido.ok) return json(res, { erro: contido.erro, arquivos: [] })
      try {
        const nomes = readdirSync(join(alvo, pasta)).filter((n) => !n.startsWith('.'))
        return json(res, { arquivos: nomes.map((n) => `${pasta}/${n}`) })
      } catch {
        return json(res, { arquivos: [] })
      }
    }
    if (req.method === 'GET' && rota === '/api/file') {
      if (exigeProjeto()) return
      const caminho = new URL(req.url, 'http://x').searchParams.get('path') ?? ''
      const contido = conter(alvo, caminho)
      if (!contido.ok) return json(res, { erro: contido.erro })
      try {
        return json(res, { caminho, conteudo: readFileSync(contido.absoluto, 'utf8') })
      } catch (e) {
        return json(res, { erro: e.message })
      }
    }
    if (rota === '/api/snapshot') {
      const i = indice()
      return json(res, {
        ...estado.snapshot(),
        cards: i.cards,
        board: i.board,
        divergencias: i.divergencias,
        git: git(),
      })
    }
    if (rota === '/api/cards') return json(res, indice())
    if (rota.startsWith('/api/cards/')) {
      const id = decodeURIComponent(rota.slice('/api/cards/'.length))
      const achado = indice().cards.find((c) => c.id === id)
      return achado ? json(res, achado) : fim(res, 404)
    }
    if (rota === '/api/git/tree') return json(res, git())
    if (rota === '/api/git/log') return exigeProjeto() ? undefined : json(res, historico(alvo))
    if (rota === '/api/git/diff') {
      if (exigeProjeto()) return
      const arquivo = new URL(req.url, 'http://x').searchParams.get('file') ?? ''
      return json(res, { arquivo, diff: diffDoArquivo(alvo, arquivo) })
    }
    if (rota === '/api/prs') return exigeProjeto() ? undefined : json(res, prsAbertos(alvo))
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

  /** Move o arquivo e alinha o `status` -- pasta e frontmatter nunca divergem. */
  function moverCard(id, corpo, res) {
    let para
    try {
      para = JSON.parse(corpo).para
    } catch {
      para = null
    }
    if (!COLUNAS.includes(para)) {
      res.writeHead(422, { 'content-type': 'application/json; charset=utf-8' })
      return res.end(JSON.stringify({ erro: `coluna desconhecida: "${para}"` }))
    }
    const card = indexarCards(projeto).cards.find((c) => c.id === id)
    if (!card) return fim(res, 404)

    const destinoDir = join(projeto, 'cards', para)
    const destino = join(destinoDir, card.arquivo.split(/[/\\]/).pop())
    try {
      const texto = readFileSync(card.arquivo, 'utf8').replace(/^status:.*$/m, `status: ${para}`)
      mkdirSync(destinoDir, { recursive: true })
      writeFileSync(card.arquivo, texto)
      renameSync(card.arquivo, destino)
    } catch (e) {
      res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' })
      return res.end(JSON.stringify({ erro: e.message }))
    }
    registrar({ kind: 'card.move', loop: 'L3', card: id, session: null, payload: { para } })
    return json(res, { ok: true, id, para })
  }

  function registrar(parcial) {
    const evento = {
      ts: new Date().toISOString(),
      agent: null,
      parent_agent: null,
      ...parcial,
    }
    estado.registrar(evento)
    transmitir(evento)
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

  // Receptor OTLP num servidor proprio: o exportador do Claude Code fala com
  // um endpoint dedicado, e misturar isso com a API da tela so confunde.
  const otlp = createServer((req, res) => {
    if (req.method !== 'POST' || !req.url.startsWith('/v1/metrics')) return fim(res, 404)
    let corpo = ''
    req.on('data', (c) => (corpo += c))
    req.on('end', () => {
      try {
        for (const medida of extrairMedidas(JSON.parse(corpo))) {
          registrar({
            kind: medida.tipo === 'custo' ? 'custo' : 'tokens',
            loop: 'L2',
            session: medida.session,
            card: cardDaSessao(medida.session),
            payload: medida.tipo === 'custo' ? { usd: medida.usd } : { tokens: medida.quantidade },
          })
        }
      } catch {
        /* payload ruim nao pode derrubar o receptor */
      }
      // 200 sempre: exportador OTel que recebe erro para de tentar.
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end('{}')
    })
  })

  /** Liga a sessao ao card em que ela trabalhou, quando da. */
  function cardDaSessao(session) {
    for (let i = estado.snapshot().fluxo.length - 1; i >= 0; i--) {
      const e = estado.snapshot().fluxo[i]
      if (e.session === session && e.card) return e.card
    }
    return null
  }

  return { servidor, estado, observador, runner, otlp }
}

const json = (res, dados) => {
  res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(dados))
}
const fim = (res, codigo) => {
  res.writeHead(codigo)
  res.end()
}
