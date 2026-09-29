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

/**
 * O ciclo inteiro do lado local: lê o `Estado` vivo, redige sessões e
 * fluxo, e só escreve quando o conteúdo mudou de verdade -- comparar o
 * arquivo inteiro faria o carimbo `atualizado` sozinho parecer mudança, e o
 * publish-loop de 30s viraria commit+push pra sempre mesmo com a máquina
 * parada (revisão do PR #4).
 */
export function publicarEstadoAtivo({ estado, publicoPath, agora = Date.now(), janelaAtivaMs, limiteEventos }) {
  const snap = estado.snapshot()
  const sessoes = redigirSessoes(snap.sessoes, { agora, janelaAtivaMs })
  const eventos = redigirFluxo(snap.fluxo, { limite: limiteEventos })
  const atual = lerEstadoPublico(publicoPath)
  const mudou = JSON.stringify(atual.sessoes) !== JSON.stringify(sessoes) || JSON.stringify(atual.eventos) !== JSON.stringify(eventos)
  if (mudou) escreverEstadoPublico(publicoPath, { sessoes, eventos })
  return { sessoes, eventos, mudou }
}
