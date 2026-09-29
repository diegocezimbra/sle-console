/**
 * Resumo de card para o celular (CARD-094).
 *
 * `/api/cards` devolve o card inteiro, corpo incluso: 236 cards = 1,3 MB, o que
 * numa rede 4G e a primeira tela inteira. O celular so precisa do que aparece
 * na linha do card; o corpo vem sob demanda (`/api/cards/<id>`) e a busca no
 * corpo roda aqui, no servidor.
 */
import { extractQuestion } from './question.js'
import { normalizarPrioridade, pesoPrioridade } from './prioridade.js'

// So o que a linha do card mostra (o resto vem em /api/cards/<id>): cada campo a mais e multiplicado por 250 cards em 4G.
const KEPT_FIELDS = ['id', 'title', 'prioridade', 'coluna', 'rotuloProjeto', 'modificado']

/** `diegocezimbra/01-app-billing` -> `01-app-billing`. O parser le `project:` vazio como `{}`: vira ''. */
export function projectLabel(project) {
  if (typeof project !== 'string') return ''
  return project.trim().split('/').filter(Boolean).at(-1) ?? ''
}

export function summarizeCard(card) {
  const summary = {}
  for (const key of KEPT_FIELDS) if (card[key] !== undefined) summary[key] = card[key]
  summary.project = typeof card.project === 'string' ? card.project.trim() : ''
  summary.projectLabel = projectLabel(card.project)
  if (card.coluna === 'pendente-diego') summary.question = extractQuestion(card)
  return summary
}

/** `{board: {coluna: [resumo]}, total}`: o mesmo agrupamento e ordem do indice completo. */
export function summarizeIndex({ board }) {
  const summarized = {}
  let total = 0
  for (const [column, cards] of Object.entries(board ?? {})) {
    summarized[column] = cards.map(summarizeCard)
    total += cards.length
  }
  return { board: summarized, total }
}

/** Sem acento nem caixa; um caractere de entrada gera um de saida (o trecho do achado aponta para o texto original). */
function fold(text) {
  return [...String(text ?? '')].map((ch) => ch.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()).join('')
}

const SNIPPET_RADIUS = 70

function snippetAround(body, terms) {
  const original = String(body ?? '').replace(/\s+/g, ' ')
  const folded = fold(original)
  const at = terms.map((t) => folded.indexOf(t)).filter((i) => i >= 0).sort((a, b) => a - b)[0]
  if (at === undefined) return ''
  const from = Math.max(0, at - SNIPPET_RADIUS)
  const to = Math.min(original.length, at + SNIPPET_RADIUS)
  return `${from > 0 ? '…' : ''}${original.slice(from, to).trim()}${to < original.length ? '…' : ''}`
}

/** Relevancia: id > titulo > projeto > corpo. `null` se algum termo nao aparece em lugar nenhum. */
function relevance(card, terms) {
  const id = fold(card.id)
  const title = fold(card.title)
  const project = fold(typeof card.project === 'string' ? card.project : '')
  const body = fold(card.corpo)
  const all = `${id} ${title} ${project} ${body}`
  if (!terms.every((t) => all.includes(t))) return null
  let score = 0
  if (terms.every((t) => id === t || id.endsWith(`-${t}`))) score += 100
  else if (terms.some((t) => id.includes(t))) score += 60
  if (terms.every((t) => title.includes(t))) score += 40
  if (terms.every((t) => `${title} ${project}`.includes(t))) score += 20
  return { score, inBodyOnly: !terms.every((t) => `${id} ${title} ${project}`.includes(t)) }
}

/** Busca em id, titulo, projeto e corpo (todos os termos, sem acento nem caixa). Termo vazio nao devolve tudo. */
export function searchCards(cards, term, limit = 60) {
  const terms = fold(term).split(/\s+/).filter(Boolean)
  if (!terms.length) return []
  const hits = []
  for (const card of cards) {
    const r = relevance(card, terms)
    if (!r) continue
    const summary = summarizeCard(card)
    if (r.inBodyOnly) summary.snippet = snippetAround(card.corpo, terms)
    hits.push({ summary, score: r.score, weight: pesoPrioridade(normalizarPrioridade(card.prioridade)), modified: card.modificado ?? '' })
  }
  hits.sort((a, b) => b.score - a.score || a.weight - b.weight || (a.modified < b.modified ? 1 : -1))
  return hits.slice(0, limit).map((h) => h.summary)
}
