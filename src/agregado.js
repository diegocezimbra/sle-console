/**
 * A visão de todos os projetos ao mesmo tempo.
 *
 * Com dezenas de repositórios, olhar um por vez esconde o que importa: onde
 * está o trabalho e onde está o risco. Aqui os cards de todos entram no mesmo
 * board, cada um carregando de onde veio.
 */
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
