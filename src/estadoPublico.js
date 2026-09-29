/**
 * Ponte local → nuvem para "quem está trabalhando agora" (CARD-120).
 *
 * O console em `CONSOLE_MODE=git` só enxerga commits: os hooks de sessão
 * (`bin/deus-hook-console`) postam eventos em `http://127.0.0.1:7717`, que só
 * existe na máquina local. Sem rede direta entre a nuvem e a máquina, o único
 * canal que os dois já compartilham é o próprio git -- o mesmo que carrega
 * `cards/` e `respostas/`.
 *
 * A primeira versão publicava o censo estático (`estado/sessoes.json`,
 * atualizado à mão por `deus sessao set`) -- e por isso toda sessão chegava
 * na nuvem com `ativa:false` e `ultimo` de horas atrás: aquele arquivo não é
 * o registro que os hooks alimentam. Este módulo agora publica o MESMO
 * `Estado` (estado.js) que a aba Agentes do console local usa -- sessão
 * viva de verdade, com o último evento de cada uma.
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

const JANELA_ATIVA_MS_PADRAO = 10 * 60_000
const LIMITE_EVENTOS_PADRAO = 60

/**
 * Sessão viva (`Estado#snapshot().sessoes`) -> retrato publicável. Nada de
 * pid, socket ou cwd completo -- só o que responde "quem trabalha em quê".
 * `ativa` é recalculada aqui com a janela do CARD-120 (10min), não a do
 * `Estado` local (15min): quem lê pela nuvem pode estar minutos atrás do
 * `git pull`, e um limiar mais folgado esconderia sessão parada há pouco.
 */
export function redigirSessoes(sessoesEstado, { agora = Date.now(), janelaAtivaMs = JANELA_ATIVA_MS_PADRAO } = {}) {
  return (sessoesEstado ?? []).map((s) => {
    const inativoMs = s.ultimo ? agora - Date.parse(s.ultimo) : null
    return {
      sessao: s.id,
      projeto: s.projeto ?? null,
      agente: s.agente ?? null,
      card: s.card ?? null,
      ultimoPasso: s.ultimoPasso ?? null,
      eventos: s.eventos ?? null,
      ultimo: s.ultimo ?? null,
      ativa: inativoMs != null ? inativoMs < janelaAtivaMs : false,
    }
  })
}

/**
 * Fluxo bruto -> só o que a régua desenha (`ts`/`loop`/`kind` e a sessão
 * dona do traço). Nunca comando, arquivo ou `cwd`: o fluxo local carrega
 * detalhe de trabalho que não é pra sair da máquina.
 */
export function redigirFluxo(fluxoEstado, { limite = LIMITE_EVENTOS_PADRAO } = {}) {
  return (fluxoEstado ?? []).slice(-limite).map((e) => ({ ts: e.ts, loop: e.loop, kind: e.kind, session: e.session ?? null }))
}

/** Write + rename: quem lê nunca pega o arquivo pela metade. */
export function escreverEstadoPublico(caminho, { sessoes, eventos }) {
  mkdirSync(dirname(caminho), { recursive: true })
  const tmp = `${caminho}.tmp-${process.pid}`
  const conteudo = JSON.stringify({ atualizado: new Date().toISOString(), sessoes, eventos }, null, 2) + '\n'
  writeFileSync(tmp, conteudo)
  renameSync(tmp, caminho)
}

export function lerEstadoPublico(caminho) {
  try {
    const j = JSON.parse(readFileSync(caminho, 'utf8'))
    return {
      atualizado: j.atualizado ?? null,
      sessoes: Array.isArray(j.sessoes) ? j.sessoes : [],
      eventos: Array.isArray(j.eventos) ? j.eventos : [],
    }
  } catch {
    return { atualizado: null, sessoes: [], eventos: [] }
  }
}

const THROTTLE_PADRAO_MS = 2 * 60_000

/**
 * Só os campos que definem "mudou de verdade": sessão nova ou sumida,
 * `card`, `agente`, `modelo` e a atividade já calculada (ordenados por
 * `sessao`, porque `Estado#snapshot()` reordena pelo `ultimo` a cada evento
 * -- sem ordenar aqui, a MESMA sessão trocando de posição no array já
 * pareceria mudança). `ultimoPasso`, `ultimo` e `eventos` ficam de fora de
 * propósito: são voláteis, mudam a cada evento de uma sessão que já estava
 * ativa, e foi por isso que a revisão do PR #6 pegou o publish-loop
 * commitando a cada 30s com qualquer sessão viva.
 */
function chaveEstavelSessoes(sessoes) {
  return JSON.stringify(
    (sessoes ?? [])
      .map((s) => ({ sessao: s.sessao, card: s.card ?? null, agente: s.agente ?? null, modelo: s.modelo ?? null, ativa: !!s.ativa }))
      .sort((a, b) => String(a.sessao).localeCompare(String(b.sessao)))
  )
}

/**
 * O fluxo é comparado pelo CONJUNTO de pares `kind`+`session` distintos,
 * nunca pela lista posicional nem por `ts`: uma sessão ativa manda
 * `tool.post` atrás de `tool.post` o tempo todo, e cada evento novo cresce o
 * array -- comparar a lista inteira faria a MESMA atividade de sempre
 * parecer mudança de novo a cada evento. Um tipo de passo novo (ou uma
 * sessão nova aparecendo no fluxo) muda o conjunto; o quinto `tool.post`
 * seguido da mesma sessão, não.
 */
function chaveEstavelFluxo(eventos) {
  const chaves = new Set((eventos ?? []).map((e) => `${e.kind}|${e.session ?? ''}`))
  return JSON.stringify([...chaves].sort())
}

/**
 * Publicador com memória: fecha sobre `ultimoCommitEm` pra aplicar duas
 * proteções entre chamadas sucessivas do publish-loop (a cada 30s) --
 * 1) só escreve quando `card`/`agente`/`modelo`/`ativa`/fluxo mudam de
 *    verdade (campo volátil sozinho não conta -- revisão do PR #4);
 * 2) mesmo com mudança real, no máximo 1 escrita a cada `throttleMs`
 *    (padrão 2min): mudança rápida demais (várias sessões batendo evento
 *    junto) acumula e sai na próxima janela, com o estado mais recente --
 *    nunca um instantâneo intermediário perdido (revisão do PR #6).
 * Os campos voláteis vão pro arquivo em toda escrita que de fato acontece:
 * só a DECISÃO de escrever ignora eles, o conteúdo escrito é sempre completo.
 */
export function criarPublicadorEstado({ estado, publicoPath, janelaAtivaMs, limiteEventos, throttleMs = THROTTLE_PADRAO_MS }) {
  let ultimoCommitEm = 0
  return function publicar({ agora = Date.now() } = {}) {
    const snap = estado.snapshot()
    const sessoes = redigirSessoes(snap.sessoes, { agora, janelaAtivaMs })
    const eventos = redigirFluxo(snap.fluxo, { limite: limiteEventos })
    const atual = lerEstadoPublico(publicoPath)
    const mudouDeVerdade =
      chaveEstavelSessoes(atual.sessoes) !== chaveEstavelSessoes(sessoes) ||
      chaveEstavelFluxo(atual.eventos) !== chaveEstavelFluxo(eventos)
    if (!mudouDeVerdade) return { sessoes, eventos, mudou: false }
    if (agora - ultimoCommitEm < throttleMs) return { sessoes, eventos, mudou: false, throttled: true }
    escreverEstadoPublico(publicoPath, { sessoes, eventos })
    ultimoCommitEm = agora
    return { sessoes, eventos, mudou: true }
  }
}
