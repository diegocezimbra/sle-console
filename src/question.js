/**
 * A pergunta que um card em `pendente-diego` faz ao Diego (CARD-094).
 *
 * Nao existe campo "pergunta" no card: o DEUS escreve a pergunta como NOTA
 * ("PERGUNTA (Diego): ... Opcoes: \"a\" = ...") ou embute as opcoes no titulo
 * ("Responda 'x' ou 'y'"). Este modulo acha essa pergunta e as opcoes citadas
 * para a tela do celular mostrar um botao por opcao. Puro (sem disco, sem
 * relogio): recebe titulo e corpo e devolve dados, entao e testavel em node.
 */
import { extrairSecao } from './cards.js'

const MAX_OPTIONS = 8
const MAX_OPTION_LENGTH = 80

/** `- 2026-09-29T11:35:54Z · texto` (o separador e o ponto medio que `deus task note` grava). */
const NOTE_LINE = /^\s*[-*]\s+(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z)\s+[·•]\s+(.*)$/
/** Onde comeca a zona de opcoes: so aspas DEPOIS de um destes contam (rotulo de tela entre aspas nao e opcao). */
const MARKER = /(?:op[cç][õo]es|op[cç][aã]o|responda|responder|escolha|decida)\b/gi
/** Aspas duplas, curvas ou simples; a simples nao abre colada numa letra (d'agua) nem fecha antes de uma. */
const QUOTED = /"([^"\n]{1,80})"|“([^”\n]{1,80})”|(?<![\p{L}\p{N}])'([^'\n]{1,80})'(?![\p{L}\p{N}])/gu
const ANSWER_BLOCK = /## Resposta do Diego \(([^)]+)\)\n\*\*Opção:\*\* (.*)\n([\s\S]*?)(?=\n## |$)/g

/** Notas do card em ordem de arquivo (a mais antiga primeiro). */
export function parseNotes(corpo) {
  const secao = extrairSecao(corpo, 'Notas')
  if (!secao) return []
  const notes = []
  for (const linha of secao.split('\n')) {
    const m = NOTE_LINE.exec(linha)
    if (m) notes.push({ ts: m[1], text: m[2].trim() })
  }
  return notes
}

function pickQuoted(fragment) {
  const seen = new Set()
  const options = []
  for (const m of fragment.matchAll(QUOTED)) {
    const value = (m[1] ?? m[2] ?? m[3]).trim()
    const key = value.toLowerCase()
    if (!value || value.length > MAX_OPTION_LENGTH || seen.has(key)) continue
    seen.add(key)
    options.push(value)
    if (options.length === MAX_OPTIONS) break
  }
  return options
}

/** Opcoes citadas depois do ULTIMO marcador que tenha alguma; `[]` se nenhum tem. */
function quotedOptions(text) {
  const marks = [...String(text ?? '').matchAll(MARKER)]
  for (let i = marks.length - 1; i >= 0; i--) {
    const found = pickQuoted(text.slice(marks[i].index))
    if (found.length) return found
  }
  return []
}

/** Formato antigo: `## Opções` com `- A: texto` -> `A) texto`. */
function sectionOptions(corpo) {
  const secao = extrairSecao(corpo, 'Opções') ?? extrairSecao(corpo, 'Opcoes')
  if (!secao) return []
  return [...secao.matchAll(/^-?\s*([A-Z])[):]\s*(.+)$/gm)].map((m) => `${m[1]}) ${m[2].trim()}`).slice(0, MAX_OPTIONS)
}

function findQuestion(title, corpo, notes) {
  for (const note of [...notes].reverse()) {
    const options = quotedOptions(note.text)
    if (options.length) return { text: note.text, options, source: 'note', refTs: note.ts }
  }
  const fromSection = sectionOptions(corpo)
  if (fromSection.length) {
    const text = extrairSecao(corpo, 'O que decidir') ?? extrairSecao(corpo, 'Decisão') ?? extrairSecao(corpo, 'Pergunta')
    return { text: text || null, options: fromSection, source: 'section', refTs: null }
  }
  const fromTitle = quotedOptions(title)
  if (fromTitle.length) return { text: null, options: fromTitle, source: 'title', refTs: null }
  const asked = [...notes].reverse().find((n) => /^PERGUNTA\b/i.test(n.text))
  if (asked) return { text: asked.text, options: [], source: 'note', refTs: asked.ts }
  return { text: null, options: [], source: null, refTs: null }
}

/** Ultima resposta do Diego gravada no corpo (`## Resposta do Diego (AAAA-MM-DD HH:MM)`, em UTC). */
function lastAnswer(corpo) {
  const blocks = [...String(corpo ?? '').matchAll(ANSWER_BLOCK)]
  const last = blocks.at(-1)
  if (!last) return null
  const [, stamp, option, text] = last
  const at = `${stamp.trim().replace(' ', 'T')}:00Z`
  return { option: option.trim() === '—' ? '' : option.trim(), text: text.trim(), at }
}

/**
 * Respondida = ha resposta MAIS NOVA que a pergunta (ou, sem nota de pergunta,
 * que a entrada do card em pendente-diego). Uma nota de "recebi, aplicando"
 * sem opcoes nao desfaz o respondido; opcoes atualizadas depois, sim -- e uma
 * pergunta nova.
 */
function isAnswered(answer, refTs, notes) {
  if (!answer) return false
  const moved = [...notes].reverse().find((n) => /→\s*pendente-diego\b/.test(n.text))
  const floor = [refTs, moved?.ts].filter(Boolean).sort().at(-1)
  return !floor || answer.at.slice(0, 16) >= floor.slice(0, 16)
}

/**
 * @returns {{text: string|null, options: string[], source: 'note'|'section'|'title'|null,
 *            answered: {option: string, text: string, at: string}|null}}
 */
export function extractQuestion({ title, corpo }) {
  const notes = parseNotes(corpo)
  const { refTs, ...question } = findQuestion(String(title ?? ''), corpo, notes)
  const answer = lastAnswer(corpo)
  return { ...question, answered: isAnswered(answer, refTs, notes) ? answer : null }
}
