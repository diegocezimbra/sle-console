/**
 * A visão de todos os projetos ao mesmo tempo.
 *
 * Com dezenas de repositórios, olhar um por vez esconde o que importa: onde
 * está o trabalho e onde está o risco. Aqui os cards de todos entram no mesmo
 * board, cada um carregando de onde veio.
 */
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
