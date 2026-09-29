// Linha compacta de card (id, P, titulo em 2 linhas, projeto), usada no Quadro e na Busca.
import { h } from './dom.js'
import { priorityChip, priorityTone } from './priority.js'

/** Ordem de exibicao: a do `deus task board` (o pipeline da esquerda para a direita). */
export const BOARD_ORDER = ['backlog', 'refinamento', 'aprovado', 'doing', 'review', 'testando', 'done', 'pendente-diego', 'recurring']

/** Mesmos nomes do board da CLI e do desktop, com o de decisao do Diego mais curto. */
export const COLUMN_LABELS = {
  backlog: 'Backlog', refinamento: 'Refinamento', aprovado: 'Aprovado', doing: 'Doing', review: 'Review',
  testando: 'Testando', done: 'Done', 'pendente-diego': 'Pendentes', recurring: 'Recorrentes',
}

const isPlainClick = (event) => event.button === 0 && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey

/**
 * O card inteiro e um link (`/card/<id>`): abre em nova guia sem JS. `onOpen(id)` abre por dentro
 * do app (sem recarregar) quando o clique e comum.
 */
export function cardRow(card, { showColumn = false, showSnippet = false, onOpen } = {}) {
  const row = h('a', { class: 'm-row', href: `/card/${encodeURIComponent(card.id)}`, dataset: { card: card.id, tone: priorityTone(card.prioridade) } },
    h('span', { class: 'm-row-meta' },
      h('span', { class: 'm-row-id' }, card.id),
      priorityChip(card.prioridade),
      showColumn ? h('span', { class: 'm-chip m-col-chip' }, COLUMN_LABELS[card.coluna] ?? card.coluna) : null,
      card.projectLabel ? h('span', { class: 'm-proj' }, card.projectLabel) : null),
    h('span', { class: 'm-row-title' }, card.title ?? ''),
    showSnippet && card.snippet ? h('span', { class: 'm-row-snippet' }, card.snippet) : null)
  if (onOpen) {
    row.addEventListener('click', (event) => {
      if (!isPlainClick(event)) return
      event.preventDefault()
      onOpen(card.id)
    })
  }
  return row
}

export const rowSignature = (card) => JSON.stringify([card.id, card.title, card.prioridade, card.projectLabel, card.coluna, card.snippet ?? null])
