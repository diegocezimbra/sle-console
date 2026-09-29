/**
 * O daemon da Fase 1: observar. Nada de escrita, nada de controle.
 *
 * `node:http` puro e zero dependencia -- numa ferramenta que fica no meio do
 * seu ambiente de trabalho, cada dependencia e superficie de ataque.
 */
import { createServer } from 'node:http'
import { spawn, spawnSync } from 'node:child_process'
import { readdirSync, readFileSync, renameSync, mkdirSync, writeFileSync, appendFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, relative } from 'node:path'

import { Estado } from './estado.js'
import { createAuthMiddleware } from './auth.js'
import { startPullLoop, commitAndPush } from './gitSync.js'
import { criarPublicadorEstado, lerEstadoPublico } from './estadoPublico.js'
import { normalizar } from './ingest.js'
import { indexarCards } from './cards.js'
import { diffDoArquivo, estadoDoGit, historico, prsAbertos } from './repo.js'
import { observarArvore } from './watcher.js'
import { conter, salvarArquivo } from './escrita.js'
import { chavesDoCard, destinatarioDoAmbiente, salvarCredencial, statusDasChaves } from './credenciais.js'
import { testarComando } from './verificacao.js'
import { Runner } from './runner.js'
import { decidirGate } from './gates.js'
import { calcularMetricas } from './metricas.js'
import { montarHistorico } from './historico.js'
import { extrairMedidas } from './otel.js'
import { COLUNAS, lerCard } from './cards.js'
import { createChatRoutes } from './chat-routes.js'
import { createMobileRoutes } from './mobile-routes.js'
import { createStaticFiles } from './static-files.js'
import { descobrirProjetos, invalidarCache, resolverProjeto } from './projetos.js'
import {
  agentesDeTodos,
  gitDeTodosAsync,
  indexarTodos,
  invalidarCacheGit,
  TODOS,
} from './agregado.js'

const WEB = join(dirname(fileURLToPath(import.meta.url)), '..', 'web')

// Caminho fixo, relativo à raiz do repositório, dos dois lados (quem publica
// local e quem lê em modo git precisam concordar sem se combinar em runtime).
const CAMINHO_ESTADO_PUBLICO = 'estado-publico/sessoes.json'
// CARD-120 (revisão): acima disto uma sessão publicada conta como parada.
// Recalculada do lado de quem LÊ (não do que foi publicado) porque o `git
// pull` na nuvem pode estar minutos atrás do último tick local.
const TTL_ESTADO_PUBLICO_MS = 10 * 60_000


/**
 * `raiz` e a arvore que contem varios projetos; `projeto` e o padrao.
 * Toda rota de leitura aceita `?projeto=`, validado contra a arvore.
 */
/** Limite da resposta do Diego (caracteres): cabe um curl/log colado inteiro. */
const LIMITE_TEXTO_RESPOSTA = 1_000_000
const LIMITE_CORPO_CREDENCIAL = 128 * 1024 // valor de 64 KB + envelope JSON (escapes)

export function criarDaemon({
  dados,
  projeto = process.cwd(),
  raiz = null,
  tetoDiarioUsd = Infinity,
  git = null, // { dataDir, keyPath, intervalMs? } quando CONSOLE_MODE=git; `projeto` já é o clone.
  // { publicoPath, dataDir, intervalMs?, janelaAtivaMs?, limiteEventos?, throttleMs? } no console LOCAL
  // (CARD-120): publica o `Estado` vivo (o mesmo que alimenta a aba Agentes daqui) redigido
  // em `publicoPath` e empurra pro git a cada `intervalMs` -- é o que o console em modo git
  // lê pra popular AGENTES e a régua, já que não tem rede direta até aqui pros hooks de sessão.
  publicarLocal = null,
  credenciaisDir = join(dados, '..', 'credenciais'), // volume privado dos `.age` (fora do git)
  ageBin = 'age',
  ageRecipient = destinatarioDoAmbiente(), // só do env do container, nunca do clone git
}) {
  const estado = new Estado(dados)
  const runner = new Runner(projeto, { tetoDiarioUsd })
  const ouvintes = new Set()
  const autorizar = createAuthMiddleware()
  const arquivosEstaticos = createStaticFiles({ webDir: WEB })
  const rotasMobile = createMobileRoutes()
  const pullLoop = git
    ? startPullLoop({
        dataDir: git.dataDir,
        keyPath: git.keyPath,
        intervalMs: git.intervalMs ?? 60_000,
        onPushResult: (r) => {
          if (!r.ok) {
            registrar({
              kind: 'git.push.falhou',
              loop: 'L3',
              card: null,
              session: null,
              payload: { erro: r.stderr, conflito: r.conflito ?? false },
            })
          }
        },
        onResult: (r) => {
          invalidarCache()
          invalidarCacheGit()
          if (!r.ok) {
            registrar({ kind: 'git.pull.falhou', loop: 'L3', card: null, session: null, payload: { erro: r.stderr } })
          }
        },
      })
    : null

  // Uma instância só por daemon: o throttle de `criarPublicadorEstado` vive
  // no fechamento (`ultimoCommitEm`) e precisa sobreviver entre ticks do
  // `setInterval` -- criar de novo a cada chamada perderia a memória do
  // throttle e voltaria a commitar sem limite (revisão do PR #6).
  const publicarEstado = publicarLocal
    ? criarPublicadorEstado({
        estado,
        publicoPath: publicarLocal.publicoPath,
        janelaAtivaMs: publicarLocal.janelaAtivaMs,
        janelaPublicacaoMs: publicarLocal.janelaPublicacaoMs,
        limiteEventos: publicarLocal.limiteEventos,
        throttleMs: publicarLocal.throttleMs,
      })
    : null

  /** Fecha o ciclo local do CARD-120: redige o `Estado` vivo (sessões E fluxo
   *  recente, pra régua), escreve o arquivo público e empurra pro remoto --
   *  mesmo mecanismo de `commitAndPush` que já versiona `respostas/`. Erro
   *  aqui vira evento, nunca derruba o daemon: uma sessão sem publicar ainda
   *  deixa a máquina inteira observável por outra via. */
  function publicarSessoesLocais() {
    let mudou
    try {
      ;({ mudou } = publicarEstado({
        deusSessionId: lerDeusSessionId(publicarLocal.dataDir),
        cardsEmDoing: cardsEmDoing(publicarLocal.dataDir),
      }))
    } catch (erro) {
      registrar({ kind: 'estado-publico.falhou', loop: 'L3', card: null, session: null, payload: { erro: String(erro) } })
      return
    }
    // `mudou:false` cobre dois casos: nada de real mudou (campo volátil
    // sozinho não conta), ou mudou mas o throttle de 2min ainda está
    // segurando -- os dois sem o que commitar agora.
    if (!mudou) return
    const resultado = commitAndPush({
      dataDir: publicarLocal.dataDir,
      paths: [relative(publicarLocal.dataDir, publicarLocal.publicoPath)],
      message: 'chore(console): publica sessões ativas',
    })
    if (!resultado.ok) {
      registrar({ kind: 'git.push.falhou', loop: 'L3', card: null, session: null, payload: { erro: resultado.stderr } })
    }
  }
  const publicarLoop = publicarLocal
    ? setInterval(publicarSessoesLocais, publicarLocal.intervalMs ?? 30_000)
    : null
  publicarLoop?.unref?.()

  /**
   * O DEUS não manda evento a cada minuto -- pode passar horas entre um
   * `deus tokens` e o próximo -- e uma sessão dele podada ou some do censo é
   * o painel escondendo justo o alarme "DEUS travado" que ele existe pra
   * mostrar. `estado/deus-session-id` (escrito pelo próprio DEUS no boot) é
   * a única fonte -- sem arquivo, sem proteção por id; a proteção por
   * `agente:'deus'` continua valendo (revisão do PR #7).
   */
  function lerDeusSessionId(dir) {
    try {
      return readFileSync(join(dir, 'estado', 'deus-session-id'), 'utf8').trim() || null
    } catch {
      return null
    }
  }

  /** Card em `doing` com a sessão dona sem evento há horas é card travado --
   *  informação que some se a sessão sai do censo antes de alguém ver
   *  (revisão do PR #7). Falha de leitura vira conjunto vazio, nunca exceção
   *  -- poda/publish não podem cair por causa de `cards/` ilegível. */
  function cardsEmDoing(dir) {
    try {
      return new Set(indexarCards(dir).cards.filter((c) => c.coluna === 'doing').map((c) => c.id))
    } catch {
      return new Set()
    }
  }

  // Poda periódica do índice em memória (CARD-120c) -- de hora em hora, não
  // a cada evento: é limpeza de fundo, não precisa reagir na hora, e rodar
  // menos vezes custa menos CPU num daemon que já reconstrói do zero a cada
  // boot. Lê a proteção do MESMO diretório que o publish-loop (o repositório
  // dono do censo quando existe; senão o próprio projeto observado).
  const dirDeProtecao = publicarLocal?.dataDir ?? projeto
  const podaLoop = setInterval(
    () => estado.podar({ deusSessionId: lerDeusSessionId(dirDeProtecao), cardsEmDoing: cardsEmDoing(dirDeProtecao) }),
    60 * 60_000
  )
  podaLoop.unref?.()

  /** Lado do console em modo git: lê o arquivo que a máquina local publicou
   *  (via `publicarSessoesLocais`, chegado por `git pull`) e devolve no
   *  mesmo formato de `estado.snapshot().sessoes`, pra AGENTES e a régua não
   *  precisarem saber a diferença entre uma sessão vista por hook e uma vista
   *  por git. `ativa` é recalculada aqui pelo `ultimo` de verdade -- nunca
   *  pelo `ativa` já publicado, que pode ter horas de `git pull` de atraso.
   *  Fora do modo git, não há o que ler -- lista vazia, sem custo. */
  function sessoesPublicadas() {
    if (!git) return []
    const agora = Date.now()
    const { sessoes } = lerEstadoPublico(join(git.dataDir, CAMINHO_ESTADO_PUBLICO))
    return sessoes.map((s) => {
      const inativoMs = s.ultimo ? agora - Date.parse(s.ultimo) : null
      return {
        id: s.sessao,
        agente: s.agente ?? null,
        projeto: s.projeto ?? null,
        card: s.card ?? null,
        ultimoPasso: s.ultimoPasso ?? null,
        eventos: s.eventos ?? null,
        inicio: null,
        ultimo: s.ultimo ?? null,
        inativoMs,
        ativa: inativoMs != null ? inativoMs < TTL_ESTADO_PUBLICO_MS : false,
      }
    })
  }

  /** A régua também precisa de traço em modo git -- sem fluxo publicado ela
   *  fica sempre em branco, porque este `Estado` nunca recebe hook nenhum.
   *  Mesclado (não substituído) porque `git.tree`/respostas ainda podem
   *  gerar eventos de sistema locais aqui. */
  function fluxoPublicado() {
    if (!git) return []
    return lerEstadoPublico(join(git.dataDir, CAMINHO_ESTADO_PUBLICO)).eventos
  }

  /** Commita e empurra tudo que mudou em `cards/` no clone -- no-op fora do
   *  modo git. `-A` na raiz de `cards/` (ver gitSync.js) cobre tanto edição
   *  quanto mover o arquivo entre pastas de coluna (some de um lado, aparece
   *  no outro) num commit só. */
  function commitCardNoGit(mensagem, caminhosExtras = []) {
    if (!git) return { ok: true }
    const resultado = commitAndPush({
      dataDir: git.dataDir,
      keyPath: git.keyPath,
      paths: [relative(git.dataDir, join(projeto, 'cards')), ...caminhosExtras],
      message: mensagem,
    })
    if (!resultado.ok) {
      registrar({ kind: 'git.push.falhou', loop: 'L3', card: null, session: null, payload: { erro: resultado.stderr } })
    }
    return resultado
  }

  // O disco e a verdade: quando ele muda, a tela sabe. Sem polling.
  const observador = observarArvore(projeto)
  observador.aoMudar((mudanca) => {
    // Disco mudou: a próxima varredura precisa ver o que mudou.
    invalidarCache()
    invalidarCacheGit()
    return
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
  })

  const servidor = createServer((req, res) => {
    const rota = req.url?.split('?')[0] ?? '/'
    // Liveness do container: sem credencial, pra não travar o HEALTHCHECK do
    // Docker/Coolify quando CONSOLE_USER/CONSOLE_PASSWORD estão setados.
    if (rota === '/api/health') return json(res, { ok: true })
    if (!autorizar(req, res)) return
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
    const git = async () => (todos ? gitDeTodosAsync(raiz) : estadoDoGit(alvo))

    // Páginas e assets de `web/` (inclui as rotas amigáveis do card e das abas, que servem o
    // mesmo index.html — sem isso Ctrl+clique/nova guia/F5 caem num 404) e a API enxuta do celular.
    if (arquivosEstaticos.handle(req, res, rota)) return
    if (rotasMobile(req, res, rota, indice)) return

    // CARD-202: cofre de credenciais de teste. A API só devolve NOME + STATUS; o valor entra por PUT, é criptografado
    // com a chave pública do DEUS e nunca mais sai daqui (o DEUS puxa o `.age` por SSH e apaga).
    if (req.method === 'GET' && /^\/api\/cards\/[^/]+\/credentials$/.test(rota)) {
      const id = decodeURIComponent(rota.split('/')[3])
      const card = indice().cards.find((c) => c.id === id) ?? achadoEmTodos(id)
      if (!card) return fim(res, 404)
      const chaves = chavesDoCard(card.corpo)
      return json(res, { credentials: statusDasChaves({ chaves, dirAge: credenciaisDir, raizPublica: projeto }) })
    }
    if (req.method === 'PUT' && /^\/api\/credentials\/[^/]+$/.test(rota)) {
      const nome = decodeURIComponent(rota.split('/')[3])
      return lerCorpo(req, LIMITE_CORPO_CREDENCIAL, (corpo) => {
        if (corpo === null) {
          res.writeHead(413, { 'content-type': 'application/json; charset=utf-8' })
          return res.end(JSON.stringify({ erro: 'corpo acima do limite' }))
        }
        let valor
        try {
          valor = JSON.parse(corpo).value
        } catch {
          valor = undefined
        }
        const r = salvarCredencial({ dirAge: credenciaisDir, destinatario: ageRecipient, nome, valor, ageBin })
        res.writeHead(r.ok ? 200 : r.codigo, { 'content-type': 'application/json; charset=utf-8' })
        res.end(JSON.stringify(r.ok ? { ok: true, name: r.name, status: r.status } : { erro: r.erro }))
      })
    }

    if (req.method === 'POST' && /^\/api\/cards\/[^/]+\/answer$/.test(rota)) {
      const id = decodeURIComponent(rota.split('/')[3])
      return lerCorpo(req, (corpo) => registrarResposta(indice(), id, corpo, res, registrar))
    }

    if (req.method === 'POST' && /^\/api\/cards\/[^/]+\/resolve$/.test(rota)) {
      const id = decodeURIComponent(rota.split('/')[3])
      return lerCorpo(req, (corpo) => resolverPendencia(indice(), id, corpo, res, registrar))
    }

    if (rota === '/api/projetos') {
      return json(res, {
        raiz,
        atual: todos ? TODOS : alvo,
        todos: TODOS,
        projetos: raiz ? descobrirProjetos(raiz) : [],
      })
    }

    if (rotasChat(req, res, rota)) return
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
      // `ativos` sao processos que o console lancou; `sessoes` sao as que ele
      // observa. Mostrar so os primeiros faz a tela dizer "nenhum agente
      // rodando" enquanto cinco sessoes trabalham.
      return json(res, {
        agentes: todos ? agentesDeTodos(raiz) : runner.agentes(alvo),
        ativos: runner.ativos(),
        sessoes: [...estado.snapshot().sessoes.filter((x) => x.ativa), ...sessoesPublicadas()],
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
      return git().then((g) =>
        json(res, {
          ...estado.snapshot(),
          sessoes: [...estado.snapshot().sessoes, ...sessoesPublicadas()],
          // Mesclado e reordenado por ts: a régua assume a lista em ordem
          // cronológica (primeiro/último evento marcam as pontas do eixo).
          fluxo: [...estado.snapshot().fluxo, ...fluxoPublicado()].sort((a, b) => a.ts.localeCompare(b.ts)),
          cards: i.cards,
          board: i.board,
          divergencias: i.divergencias,
          git: g,
        })
      )
    }
    if (rota === '/api/cards') return json(res, indice())
    if (rota.startsWith('/api/cards/')) {
      const id = decodeURIComponent(rota.slice('/api/cards/'.length))
      // O id do card é único no parque inteiro: se o projeto pedido (ou o
      // default) não o contém, cai para todos os projetos antes de dar 404 --
      // sem isso o modal trava sempre que o seletor está num projeto que não
      // é o dono do card.
      const achado = indice().cards.find((c) => c.id === id) ?? achadoEmTodos(id)
      return achado ? json(res, { ...achado, opcoes: [...opcoesDoCard(achado.corpo ?? ''), 'Outra'] }) : fim(res, 404)
    }
    if (rota === '/api/git/tree') return git().then((g) => json(res, g))
    if (rota === '/api/git/log') return exigeProjeto() ? undefined : json(res, historico(alvo))
    if (rota === '/api/git/diff') {
      if (exigeProjeto()) return
      const arquivo = new URL(req.url, 'http://x').searchParams.get('file') ?? ''
      return json(res, { arquivo, diff: diffDoArquivo(alvo, arquivo) })
    }
    if (rota === '/api/prs') return exigeProjeto() ? undefined : json(res, prsAbertos(alvo))
    if (rota === '/api/stream') return abrirStream(res)

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

  /** Move o arquivo pra pasta da coluna `para` e alinha o `status` no
   *  frontmatter -- pasta e frontmatter nunca divergem. Sem `deus task
   *  move` (não existe fora da máquina do DEUS): é o mesmo passo usado
   *  localmente e no modo git. Devolve o caminho absoluto do destino. */
  function moverArquivoDoCard(card, para) {
    const destinoDir = join(projeto, 'cards', para)
    const destino = join(destinoDir, card.arquivo.split(/[/\\]/).pop())
    const texto = readFileSync(card.arquivo, 'utf8').replace(/^status:.*$/m, `status: ${para}`)
    mkdirSync(destinoDir, { recursive: true })
    writeFileSync(card.arquivo, texto)
    renameSync(card.arquivo, destino)
    return destino
  }

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

    let sincronizado
    try {
      moverArquivoDoCard(card, para)
      sincronizado = commitCardNoGit(`mover CARD-${id}: ${para}`)
    } catch (e) {
      res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' })
      return res.end(JSON.stringify({ erro: e.message }))
    }
    registrar({ kind: 'card.move', loop: 'L3', card: id, session: null, payload: { para } })
    const resposta = { ok: true, id, para }
    if (sincronizado && !sincronizado.ok) resposta.sync = 'pendente'
    return json(res, resposta)
  }

  /** Busca de última instância: varre todos os projetos, não só o escolhido no seletor. */
  function achadoEmTodos(id) {
    if (!raiz) return null
    return indexarTodos(raiz).cards.find((c) => c.id === id) ?? null
  }

  /** Só as linhas de opção da seção `## Opções` -- o card real escreve
   *  `- A: texto` (lista com dois-pontos), não `A) texto`; aceita os dois. */
  function opcoesDoCard(corpo) {
    const secao = /^## Op(?:ç|c)(?:õ|o)es\s*$([\s\S]*?)(?=^## |\s*$(?![\s\S]))/m.exec(corpo)
    if (!secao) return []
    return [...secao[1].matchAll(/^-?\s*([A-Z])[):]\s*(.+)$/gm)].map((m) => `${m[1]}) ${m[2].trim()}`)
  }

  const raizDeus = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
  // Chat do Diego (CARD-208): `chat/` no clone em modo git; no checkout do 00-DEUS no console local.
  const rotasChat = createChatRoutes({
    root: process.env.CONSOLE_CHAT_DIR || (git ? git.dataDir : raizDeus),
    git,
    registrar,
  })

  /** Precedência: `CONSOLE_STATE_DIR` (env) → em modo git, `<clone>/estado`
   *  (dentro do `dataDir` que o próprio processo já sabe escrever) → senão
   *  `<raiz local>/estado`. Em modo git a raiz calculada a partir do
   *  arquivo-fonte (`raizDeus`) não é o clone e pode nem existir/ser
   *  gravável (era a causa do `EACCES ... mkdir '/estado'`). */
  function diretorioDeEstado() {
    if (process.env.CONSOLE_STATE_DIR) return process.env.CONSOLE_STATE_DIR
    if (git) return join(git.dataDir, 'estado')
    return join(raizDeus, 'estado')
  }

  /** Grava a notificação para o DEUS local (`estado/respostas-diego.jsonl` +
   *  flag). Best-effort: falha aqui vira aviso no log, nunca 500 -- a
   *  resposta do Diego já está gravada e commitada no card antes de chegar
   *  aqui, então perder este passo não perde dado nenhum. */
  function gravarEstadoBestEffort(linha) {
    try {
      const estadoDir = diretorioDeEstado()
      mkdirSync(estadoDir, { recursive: true })
      appendFileSync(join(estadoDir, 'respostas-diego.jsonl'), linha + '\n')
      writeFileSync(join(estadoDir, 'respostas-pendentes.flag'), '')
    } catch (e) {
      console.warn(`aviso: falha ao gravar estado/ (best-effort, resposta já commitada): ${e.message}`)
    }
  }

  /** Em modo git, `estado/` não é versionado (gitignored no 00-DEUS) -- o
   *  jeito do DEUS local saber da resposta é o próprio push, então ela
   *  também vai para `respostas/YYYY-MM-DD.jsonl` DENTRO do clone, no mesmo
   *  commit do card. Devolve o caminho relativo ao `dataDir` pra entrar em
   *  `commitCardNoGit`, ou `null` se não deu (best-effort; o card já foi
   *  gravado e será commitado de qualquer forma). */
  function gravarRespostaVersionada(linha) {
    if (!git) return null
    try {
      const dir = join(git.dataDir, 'respostas')
      mkdirSync(dir, { recursive: true })
      const arquivo = join(dir, `${new Date().toISOString().slice(0, 10)}.jsonl`)
      appendFileSync(arquivo, linha + '\n')
      return relative(git.dataDir, arquivo)
    } catch (e) {
      console.warn(`aviso: falha ao gravar respostas/ (best-effort): ${e.message}`)
      return null
    }
  }

  /** Acrescenta a seção de resposta ao arquivo do card -- sempre síncrono e
   *  sem tratamento de erro aqui de propósito: se isso falhar, a resposta do
   *  Diego não foi gravada e o chamador precisa saber (500), diferente da
   *  notificação em `estado/` e `respostas/`, que são best-effort. Devolve a
   *  linha jsonl (pra `estado/`) e os caminhos extras do modo git (pra
   *  entrarem no mesmo commit do card). */
  function gravarSecaoResposta(card, opcao, texto) {
    const agora = new Date()
    const carimbo = agora.toISOString().slice(0, 16).replace('T', ' ')
    const secao = `\n## Resposta do Diego (${carimbo})\n**Opção:** ${opcao || '—'}\n${texto}\n`
    const texto0 = readFileSync(card.arquivo, 'utf8')
    writeFileSync(card.arquivo, texto0 + secao)
    const linha = JSON.stringify({
      ts: agora.toISOString(),
      card: card.id,
      coluna: card.coluna,
      option: opcao,
      text: texto,
      tratada: false,
    })
    const respostaVersionada = gravarRespostaVersionada(linha)
    return { linha, caminhosExtras: respostaVersionada ? [respostaVersionada] : [] }
  }

  function avisarTelegram(msg) {
    // No clone da nuvem não existe `bin/deus` -- sem o listener de erro, um
    // ENOENT assincrono derruba o processo inteiro (spawn emite 'error' fora
    // do try/catch de quem chamou).
    spawn(join(raizDeus, 'bin', 'deus'), ['telegram', msg], { detached: true, stdio: 'ignore' })
      .on('error', () => {})
      .unref()
  }

  function lerRespostaDoCorpo(corpo) {
    let pedido = {}
    try {
      pedido = JSON.parse(corpo)
    } catch {
      pedido = {}
    }
    return { opcao: String(pedido.option ?? '').trim(), texto: String(pedido.text ?? '').trim() }
  }

  /** Acrescenta a resposta do Diego ao card, registra em jsonl e avisa o DEUS. */
  function registrarResposta(indiceAtual, id, corpo, res, registrarEvento) {
    const { opcao, texto } = lerRespostaDoCorpo(corpo)
    if (!opcao && !texto) {
      res.writeHead(422, { 'content-type': 'application/json; charset=utf-8' })
      return res.end(JSON.stringify({ erro: 'opção ou texto obrigatório' }))
    }
    if (texto.length > LIMITE_TEXTO_RESPOSTA) {
      res.writeHead(422, { 'content-type': 'application/json; charset=utf-8' })
      return res.end(JSON.stringify({ erro: 'texto acima de 1000000 caracteres' }))
    }
    const card = indiceAtual.cards.find((c) => c.id === id) ?? achadoEmTodos(id)
    if (!card) return fim(res, 404)

    let linha
    let sincronizado
    try {
      const gravado = gravarSecaoResposta(card, opcao, texto)
      linha = gravado.linha
      sincronizado = commitCardNoGit(`resposta do Diego: ${id}`, gravado.caminhosExtras)
    } catch (e) {
      res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' })
      return res.end(JSON.stringify({ erro: e.message }))
    }
    gravarEstadoBestEffort(linha)
    avisarTelegram(`📝 Resposta do Diego em ${id}: ${opcao || '—'} — ${texto.slice(0, 200)}`)
    registrarEvento({ kind: 'card.resposta', loop: 'L3', card: id, session: null, payload: { option: opcao } })
    // A resposta já foi gravada e commitada localmente mesmo que o push
    // tenha falhado (deploy key sem escrita, GitHub fora do ar) -- nunca
    // fingir sucesso: o chamador sabe pelo `sync: "pendente"` que o commit
    // ainda não chegou ao remoto; `pushPendente` reteta no próximo pull.
    const resposta = { ok: true, id, option: opcao, text: texto }
    if (sincronizado && !sincronizado.ok) resposta.sync = 'pendente'
    return json(res, resposta)
  }

  /** "Pendência resolvida": grava a resposta se veio algo e move o card para
   *  `aprovado`. Localmente isso passa pelo `deus task move` (mantém nota e
   *  evento do DEUS); no modo git não existe `deus` no clone -- move o
   *  arquivo direto e escreve a nota no próprio card, depois commita+empurra.
   *  Só faz sentido a partir de `pendente-diego`. */
  function resolverPendencia(indiceAtual, id, corpo, res, registrarEvento) {
    const { opcao, texto } = lerRespostaDoCorpo(corpo)
    const card = indiceAtual.cards.find((c) => c.id === id) ?? achadoEmTodos(id)
    if (!card) return fim(res, 404)
    if (card.coluna !== 'pendente-diego') {
      res.writeHead(422, { 'content-type': 'application/json; charset=utf-8' })
      return res.end(JSON.stringify({ erro: `card não está em pendente-diego (está em ${card.coluna})` }))
    }
    const dataHoje = new Date().toISOString().slice(0, 10)
    let linha = null
    let sincronizado
    try {
      let caminhosExtras = []
      if (opcao || texto) {
        const gravado = gravarSecaoResposta(card, opcao, texto)
        linha = gravado.linha
        caminhosExtras = gravado.caminhosExtras
      }
      if (git) {
        const destino = moverArquivoDoCard(card, 'aprovado')
        appendFileSync(destino, `\n## Nota\nPendência resolvida pelo Diego (${dataHoje})\n`)
        sincronizado = commitCardNoGit(`resposta do Diego: ${id}`, caminhosExtras)
      } else {
        const mover = spawnSync(join(raizDeus, 'bin', 'deus'), ['task', 'move', id, 'aprovado'], { encoding: 'utf8' })
        if (mover.status !== 0) throw new Error(mover.stderr || 'falha ao mover para aprovado')
        spawnSync(join(raizDeus, 'bin', 'deus'), ['task', 'note', id, `Pendência resolvida pelo Diego (${dataHoje})`])
      }
    } catch (e) {
      res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' })
      return res.end(JSON.stringify({ erro: e.message }))
    }
    if (linha) gravarEstadoBestEffort(linha)
    avisarTelegram(`✔ Pendência resolvida em ${id}: ${opcao || '—'} — ${texto.slice(0, 200)}`)
    registrarEvento({ kind: 'card.resolvido', loop: 'L3', card: id, session: null, payload: { option: opcao } })
    const resposta = { ok: true, id, coluna: 'aprovado' }
    if (sincronizado && !sincronizado.ok) resposta.sync = 'pendente'
    return json(res, resposta)
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

  /** `lerCorpo(req, pronto)` ou `lerCorpo(req, limiteBytes, pronto)`: acima do limite entrega `null` e descarta o resto. */
  function lerCorpo(req, limiteOuPronto, prontoOpc) {
    const [limite, pronto] = typeof limiteOuPronto === 'function' ? [Infinity, limiteOuPronto] : [limiteOuPronto, prontoOpc]
    let corpo = ''
    let bytes = 0
    let estourou = false
    req.on('data', (c) => {
      if (estourou) return
      bytes += c.length
      if (bytes > limite) {
        estourou = true
        corpo = ''
        return pronto(null)
      }
      corpo += c
    })
    req.on('end', () => {
      if (!estourou) pronto(corpo)
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

  return {
    servidor,
    estado,
    observador,
    runner,
    otlp,
    pararGit: () => pullLoop?.stop(),
    pararPublicarLocal: () => (publicarLoop ? clearInterval(publicarLoop) : null),
    pararPoda: () => clearInterval(podaLoop),
  }
}

const json = (res, dados) => {
  res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(dados))
}
const fim = (res, codigo) => {
  res.writeHead(codigo)
  res.end()
}
