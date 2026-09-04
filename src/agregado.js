/**
 * A visão de todos os projetos ao mesmo tempo.
 *
 * Com dezenas de repositórios, olhar um por vez esconde o que importa: onde
 * está o trabalho e onde está o risco. Aqui os cards de todos entram no mesmo
 * board, cada um carregando de onde veio.
 */
import { execFile } from 'node:child_process'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { indexarCards, COLUNAS } from './cards.js'
import { estadoDoGit } from './repo.js'
import { descobrirProjetos } from './projetos.js'

/** Valor reservado do seletor. Nunca é um caminho. */
export const TODOS = '*'

export function indexarTodos(raizes) {
  const cards = []
  for (const p of descobrirProjetos(raizes)) {
    for (const card of indexarCards(p.caminho).cards) {
      cards.push({
        ...card,
        projeto: p.nome,
        rotuloProjeto: p.rotulo,
        caminhoProjeto: p.caminho,
        // Dois projetos podem ter CARD-1: a chave precisa do projeto.
        chave: `${p.caminho}#${card.id}`,
      })
    }
  }
  const board = Object.fromEntries(COLUNAS.map((c) => [c, cards.filter((x) => x.coluna === c)]))
  return { cards, board, divergencias: [] }
}

/**
 * Os agentes de todos os projetos, cada um sabendo de onde veio.
 *
 * Dois projetos podem ter um `implementer`; são agentes diferentes, com
 * modelos diferentes. Sem o projeto junto, a lista vira sopa.
 */
export function agentesDeTodos(raizes) {
  const todos = []
  for (const p of descobrirProjetos(raizes)) {
    for (const a of lerAgentes(p.caminho)) {
      todos.push({ ...a, projeto: p.nome, rotuloProjeto: p.rotulo, caminhoProjeto: p.caminho })
    }
  }
  return todos.sort((a, b) => `${a.rotuloProjeto}${a.id}`.localeCompare(`${b.rotuloProjeto}${b.id}`))
}

function lerAgentes(projeto) {
  const dir = join(projeto, 'sle', 'agents')
  try {
    return readdirSync(dir)
      .filter((n) => n.endsWith('.json'))
      .map((n) => {
        try {
          return JSON.parse(readFileSync(join(dir, n), 'utf8'))
        } catch {
          return null
        }
      })
      .filter(Boolean)
  } catch {
    return []
  }
}

/**
 * Cache do estado do git.
 *
 * Medido em 2026-09-04: `git status` em 68 repositórios, um de cada vez,
 * levava 11,5 segundos -- e o SSE pede snapshot a cada evento. Em paralelo, e
 * guardado por um tempo curto, o custo some. O watcher invalida quando o disco
 * muda.
 */
let cacheGit = null
const TTL_GIT_MS = 20000

export function invalidarCacheGit() {
  cacheGit = null
}

/** Versão assíncrona: consulta todos os repositórios ao mesmo tempo. */
export async function gitDeTodosAsync(raizes) {
  const chave = (Array.isArray(raizes) ? raizes : [raizes]).join('|')
  if (cacheGit && cacheGit.chave === chave && Date.now() - cacheGit.em < TTL_GIT_MS) {
    return cacheGit.valor
  }

  const projetos = descobrirProjetos(raizes)
  const estados = await Promise.all(projetos.map((p) => statusRapido(p)))
  const detalhe = estados.filter(Boolean)

  const valor = {
    branch: null,
    head: null,
    sujo: detalhe.length > 0,
    repos: projetos.length,
    sujos: detalhe.length,
    detalhe,
    alteracoes: [],
  }
  cacheGit = { chave, em: Date.now(), valor }
  return valor
}

/** `null` quando o repositório está limpo -- só o sujo interessa aqui. */
function statusRapido(projeto) {
  return new Promise((resolver) => {
    execFile(
      'git',
      ['status', '--porcelain'],
      { cwd: projeto.caminho, timeout: 10000 },
      (erro, saida) => {
        if (erro) return resolver(null)
        const linhas = saida.split('\n').filter(Boolean)
        resolver(linhas.length ? { projeto: projeto.rotulo, alteracoes: linhas.length } : null)
      }
    )
  })
}

/** Não existe "a branch" de 75 repositórios -- existe quantos estão sujos. */
export function gitDeTodos(raizes) {
  const projetos = descobrirProjetos(raizes)
  let sujos = 0
  const detalhe = []
  for (const p of projetos) {
    const g = estadoDoGit(p.caminho)
    if (g.sujo) {
      sujos++
      detalhe.push({ projeto: p.rotulo, alteracoes: g.alteracoes.length, branch: g.branch })
    }
  }
  return { branch: null, head: null, sujo: sujos > 0, repos: projetos.length, sujos, detalhe, alteracoes: [] }
}
