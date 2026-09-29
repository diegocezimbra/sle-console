// Prioridade no celular: mesmo mapa de src/prioridade.js e web/app.js (a tela e JS puro,
// sem bundler, entao o mapa mora aqui tambem -- os tres mudam juntos).
import { h } from './dom.js'

export const PRIORITIES = ['P-1', 'P0', 'P1', 'P2', 'P3']
export const PRIORITY_LABELS = { 'P-1': 'URGENTE', P0: 'ALTÍSSIMA', P1: 'ALTA', P2: 'MÉDIA', P3: 'BAIXA' }

/** Peso crescente: P-1 antes de P0 antes de P1. Fora do padrao (P-50, P9) cai pelo numero. */
export function priorityWeight(p) {
  const n = Number(String(p ?? 'P3').slice(1))
  return Number.isFinite(n) ? n : 3
}

/** Cor da etiqueta: mais urgente que P-1 usa a cor de P-1; alem de P3 usa a de P3. */
export function priorityTone(p) {
  const n = priorityWeight(p)
  if (n <= -1) return 'P-1'
  return PRIORITIES.includes(`P${n}`) ? `P${n}` : 'P3'
}

/** Etiqueta colorida; `withLabel` acrescenta o rotulo em palavras (URGENTE...) quando ha espaco. */
export function priorityChip(p, { withLabel = false } = {}) {
  const code = p ?? 'P3'
  const label = withLabel && PRIORITY_LABELS[code] ? ` ${PRIORITY_LABELS[code]}` : ''
  return h('span', { class: 'm-chip m-pri', dataset: { p: priorityTone(code) }, title: PRIORITY_LABELS[code] ?? code }, `${code}${label}`)
}
