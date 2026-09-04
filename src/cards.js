/**
 * Cards: o arquivo markdown e a unidade de trabalho, e o disco e a verdade.
 *
 * O frontmatter e lido por um parser proprio e deliberadamente pequeno --
 * puxar um YAML completo por causa de doze chaves seria trocar zero
 * dependencia por uma arvore inteira. O subconjunto suportado esta em
 * `interpretar`, e o que ele nao entende vira texto, nunca erro silencioso.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

/** Ordem do pipeline, nao ordem alfabetica: e assim que o board se le. */
export const COLUNAS = ['backlog', 'refinamento', 'aprovado', 'doing', 'review', 'done', 'recurring']

export function lerCard(texto) {
  if (!texto.startsWith('---')) return null
  const fim = texto.indexOf('\n---', 3)
  if (fim === -1) return null

  const cabecalho = texto.slice(texto.indexOf('\n') + 1, fim)
  const corpo = texto.slice(texto.indexOf('\n', fim + 1) + 1)
  return { ...interpretar(cabecalho), corpo }
}

/** Escalares, listas em linha (`[a, b]`) e um nivel de bloco aninhado. */
function interpretar(cabecalho) {
  const dados = {}
  let blocoAtual = null

  for (const linha of cabecalho.split('\n')) {
    if (!linha.trim() || linha.trim().startsWith('#')) continue

    const aninhada = /^\s+(\S+):\s*(.*)$/.exec(linha)
    if (aninhada && blocoAtual) {
      dados[blocoAtual][aninhada[1]] = valor(aninhada[2])
      continue
    }

    const raiz = /^(\S+):\s*(.*)$/.exec(linha)
    if (!raiz) continue
    const [, chave, cru] = raiz
    if (cru === '') {
      blocoAtual = chave
      dados[chave] = {}
    } else {
      blocoAtual = null
      dados[chave] = valor(cru)
    }
  }
  return dados
}

function valor(cru) {
  const t = cru.trim()
  if (t.startsWith('[') && t.endsWith(']')) {
    return t
      .slice(1, -1)
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean)
  }
  if (/^-?\d+(\.\d+)?$/.test(t)) return Number(t)
  if (t === 'true' || t === 'false') return t === 'true'
  return t.replace(/^["']|["']$/g, '')
}

/**
 * Varre `cards/<coluna>/*.md`.
 *
 * A pasta e a verdade sobre em que coluna o card esta -- mas quando o `status`
 * do frontmatter discorda, isso e reportado em vez de escondido: divergencia
 * silenciosa entre o que a tela mostra e o que o arquivo diz e como se perde a
 * confianca no board.
 */
export function indexarCards(raiz) {
  const cards = []
  const divergencias = []

  for (const coluna of COLUNAS) {
    const dir = join(raiz, 'cards', coluna)
    let entradas
    try {
      entradas = readdirSync(dir)
    } catch {
      continue
    }
    for (const nome of entradas) {
      if (!nome.endsWith('.md')) continue
      const arquivo = join(dir, nome)
      let card
      try {
        card = lerCard(readFileSync(arquivo, 'utf8'))
      } catch {
        continue
      }
      if (!card) continue

      const completo = { ...card, coluna, arquivo, modificado: mtime(arquivo) }
      cards.push(completo)
      if (card.status && card.status !== coluna) {
        divergencias.push({ id: card.id, arquivo, coluna, status: card.status })
      }
    }
  }

  const board = Object.fromEntries(COLUNAS.map((c) => [c, cards.filter((x) => x.coluna === c)]))
  return { cards, board, divergencias }
}

function mtime(arquivo) {
  try {
    return statSync(arquivo).mtime.toISOString()
  } catch {
    return null
  }
}
