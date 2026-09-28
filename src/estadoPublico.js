/**
 * Ponte local → nuvem para "quem está trabalhando agora" (CARD-120).
 *
 * O console em `CONSOLE_MODE=git` só enxerga commits: os hooks de sessão
 * (`bin/deus-hook-console`) postam eventos em `http://127.0.0.1:7717`, que só
 * existe na máquina local. Sem rede direta entre a nuvem e a máquina, o único
 * canal que os dois já compartilham é o próprio git -- o mesmo que carrega
 * `cards/` e `respostas/`.
 *
 * Este módulo faz a metade local: lê o censo de sessões (`estado/sessoes.json`,
 * mantido por `deus sessao set`, cheio de pid/socket/bloqueio -- detalhe de
 * máquina que não pode vazar), reduz a um retrato seguro, e escreve num
 * arquivo pequeno e versionado. Quem lê o arquivo do lado da nuvem é
 * `lerEstadoPublico`.
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

/** Só o que ajuda a responder "quem trabalha em quê" -- nada de pid, socket
 *  (`from`), lista de arquivos tocados ou bloqueio (pode conter segredo em
 *  texto livre, ex.: token vazado). */
const CAMPOS_SEGUROS = ['projeto', 'escopo', 'tarefa', 'modelo', 'atualizado']

function extrairCard(...textos) {
  for (const t of textos) {
    const m = /CARD-\d{3}/.exec(t ?? '')
    if (m) return m[0]
  }
  return null
}

/**
 * Reduz o censo cru a uma lista publicável.
 * `sessao` é a chave do censo (ex.: `"00-projetos-7a [583f38]"`); o resto
 * são só os campos da allowlist, mais `card`, extraído do texto por não
 * existir como campo estruturado no censo.
 */
export function redigirCenso(censo) {
  return Object.entries(censo ?? {}).map(([sessao, dados]) => {
    const seguro = { sessao, card: extrairCard(dados?.escopo, dados?.tarefa) }
    for (const campo of CAMPOS_SEGUROS) {
      if (dados?.[campo] != null) seguro[campo] = dados[campo]
    }
    return seguro
  })
}

export function lerCenso(caminho) {
  try {
    return JSON.parse(readFileSync(caminho, 'utf8'))
  } catch {
    return {}
  }
}

/** Write + rename: quem lê nunca pega o arquivo pela metade. */
export function escreverEstadoPublico(caminho, sessoes) {
  mkdirSync(dirname(caminho), { recursive: true })
  const tmp = `${caminho}.tmp-${process.pid}`
  const conteudo = JSON.stringify({ atualizado: new Date().toISOString(), sessoes }, null, 2) + '\n'
  writeFileSync(tmp, conteudo)
  renameSync(tmp, caminho)
}

export function lerEstadoPublico(caminho) {
  try {
    const j = JSON.parse(readFileSync(caminho, 'utf8'))
    return { atualizado: j.atualizado ?? null, sessoes: Array.isArray(j.sessoes) ? j.sessoes : [] }
  } catch {
    return { atualizado: null, sessoes: [] }
  }
}

/** O ciclo inteiro do lado local: lê o censo, redige, escreve. Devolve o que
 *  escreveu para quem chama decidir se vale commitar (lista vazia não é erro
 *  -- máquina pode estar mesmo sem sessão registrada). */
export function publicarCenso({ censoPath, publicoPath }) {
  const sessoes = redigirCenso(lerCenso(censoPath))
  escreverEstadoPublico(publicoPath, sessoes)
  return sessoes
}
