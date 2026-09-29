/**
 * Prioridade dos cards (CARD-120): o board mostrava a ordem em que o disco
 * devolvia os arquivos, não a que o Diego decidiu. `prioridade` no
 * frontmatter é a fonte -- P-1 é mais urgente que P0, que é mais urgente que
 * P1... Cartas de texto legado (urgente/altíssima/alta/média, de antes do
 * campo `P<n>` existir) mapeiam pro P equivalente; card sem o campo é P3 --
 * nunca sobe sozinho na frente de quem foi priorizado de propósito.
 */
const MAPA_LEGADO = {
  urgente: 'P0',
  altissima: 'P0',
  alta: 'P1',
  media: 'P2',
}

const PADRAO = 'P3'

/** @returns {string} sempre no formato `P<n>` (aceita negativo: `P-1`). */
export function normalizarPrioridade(bruta) {
  if (bruta == null || bruta === '') return PADRAO
  const texto = String(bruta).trim()
  if (/^P-?\d+$/i.test(texto)) return texto.toUpperCase()
  return MAPA_LEGADO[texto.toLowerCase()] ?? PADRAO
}

/** Peso crescente: menor peso vence a ordenação. P-1 antes de P0 antes de P1... */
export function pesoPrioridade(normalizada) {
  const n = Number(normalizada.slice(1))
  return Number.isFinite(n) ? n : Number(PADRAO.slice(1))
}

/** Comparador pronto pra `Array#sort` -- estável: dois cards com o mesmo P
 *  mantêm a ordem relativa que já tinham (mtime, ordem do disco). */
export function compararPorPrioridade(a, b) {
  return pesoPrioridade(normalizarPrioridade(a.prioridade)) - pesoPrioridade(normalizarPrioridade(b.prioridade))
}

export function ordenarPorPrioridade(cards) {
  return [...cards].sort(compararPorPrioridade)
}
