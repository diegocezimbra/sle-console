// Filtros do Quadro (prioridade e projeto) num painel que desliza da direita. O estado vive na
// URL (`?p=P0,P1&proj=...`, o mesmo `p` do desktop) e numa variavel do modulo, que sobrevive a
// troca de aba dentro do app.
import { h } from './dom.js'
import { PRIORITIES, PRIORITY_LABELS, priorityChip, priorityTone } from './priority.js'

const NO_PROJECT = '__none__'
const memory = { priorities: new Set(), project: '', loaded: false }

const projectKey = (card) => card.project || NO_PROJECT

export const activeCount = (filters) => filters.priorities.size + (filters.project ? 1 : 0)

export function passes(card, filters) {
  if (filters.priorities.size && !filters.priorities.has(priorityTone(card.prioridade))) return false
  return !filters.project || projectKey(card) === filters.project
}

/** A primeira leitura vem da URL; depois vale o que ficou na memoria (troca de aba nao perde filtro). */
export function currentFilters() {
  if (!memory.loaded) {
    const params = new URL(location.href).searchParams
    memory.priorities = new Set((params.get('p') ?? '').split(',').map((s) => s.trim().toUpperCase()).filter((p) => PRIORITIES.includes(p)))
    memory.project = params.get('proj') ?? ''
    memory.loaded = true
  }
  return memory
}

/** Espelha o filtro na URL sem empilhar historico: clicar num chip nao e navegar. */
export function syncFiltersToUrl() {
  const url = new URL(location.href)
  if (memory.priorities.size) url.searchParams.set('p', [...memory.priorities].join(','))
  else url.searchParams.delete('p')
  if (memory.project) url.searchParams.set('proj', memory.project)
  else url.searchParams.delete('proj')
  history.replaceState(history.state, '', url.pathname + url.search)
}

function projectOptions(cards) {
  const counts = new Map()
  for (const card of cards) counts.set(projectKey(card), (counts.get(projectKey(card)) ?? 0) + 1)
  const label = (key) => (key === NO_PROJECT ? 'sem projeto' : cards.find((c) => projectKey(c) === key)?.projectLabel || key)
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || label(a[0]).localeCompare(label(b[0]))).map(([key, count]) => ({ key, label: `${label(key)} (${count})` }))
}

/**
 * Abre o painel. `allCards` = todos os cards do quadro (sem filtro), para contar por prioridade
 * e listar os projetos; `onChange()` roda a cada toque, entao o quadro atras ja reflete o filtro.
 */
export function openFilterDrawer({ allCards, onChange, opener }) {
  const filters = currentFilters()
  const overlay = h('div', { class: 'm-drawer-overlay' })
  const title = h('h2', { id: 'm-drawer-title', class: 'm-drawer-title' }, 'Filtros')
  const close = h('button', { type: 'button', class: 'm-close', 'aria-label': 'Fechar filtros' }, '✕')
  const chipsBox = h('div', { class: 'm-filter-chips', role: 'group', 'aria-label': 'Prioridade' })
  const select = h('select', { class: 'm-select', 'aria-label': 'Projeto' })
  const clear = h('button', { type: 'button', class: 'm-clear' }, 'Limpar filtros')
  const apply = h('button', { type: 'button', class: 'm-apply' })
  const drawer = h('aside', { class: 'm-drawer', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'm-drawer-title' },
    h('div', { class: 'm-drawer-head' }, title, close),
    h('div', { class: 'm-drawer-body' }, h('h3', { class: 'm-drawer-h3' }, 'Prioridade'), chipsBox, h('h3', { class: 'm-drawer-h3' }, 'Projeto'), select),
    h('div', { class: 'm-drawer-foot' }, clear, apply))
  overlay.append(drawer)

  const counts = Object.fromEntries(PRIORITIES.map((p) => [p, allCards.filter((c) => priorityTone(c.prioridade) === p).length]))
  const options = projectOptions(allCards)

  function paint() {
    chipsBox.replaceChildren(...PRIORITIES.map((p) => {
      const chip = h('button', { type: 'button', class: 'm-fchip', 'aria-pressed': String(filters.priorities.has(p)), dataset: { p } },
        priorityChip(p), h('span', { class: 'm-fchip-label' }, `${PRIORITY_LABELS[p]} (${counts[p]})`))
      chip.addEventListener('click', () => {
        if (filters.priorities.has(p)) filters.priorities.delete(p)
        else filters.priorities.add(p)
        changed()
      })
      return chip
    }))
    select.replaceChildren(h('option', { value: '' }, `Todos os projetos (${allCards.length})`), ...options.map((o) => h('option', { value: o.key }, o.label)))
    select.value = filters.project
    const matching = allCards.filter((c) => passes(c, filters)).length
    apply.textContent = `Ver ${matching} ${matching === 1 ? 'card' : 'cards'}`
    clear.disabled = activeCount(filters) === 0
  }
  function changed() {
    syncFiltersToUrl()
    onChange()
    paint()
  }

  const dismiss = () => {
    document.removeEventListener('keydown', onKey)
    overlay.classList.remove('open')
    setTimeout(() => overlay.remove(), 220)
    opener?.focus()
  }
  function onKey(event) {
    if (event.key === 'Escape') return dismiss()
    if (event.key !== 'Tab') return
    const focusables = [...drawer.querySelectorAll('button:not(:disabled), select')]
    const first = focusables[0]
    const last = focusables.at(-1)
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
  }
  select.addEventListener('change', () => { filters.project = select.value; changed() })
  clear.addEventListener('click', () => { filters.priorities.clear(); filters.project = ''; changed() })
  apply.addEventListener('click', dismiss)
  close.addEventListener('click', dismiss)
  overlay.addEventListener('click', (event) => { if (event.target === overlay) dismiss() })
  document.addEventListener('keydown', onKey)

  paint()
  document.getElementById('m-app').append(overlay)
  requestAnimationFrame(() => {
    overlay.classList.add('open')
    close.focus()
  })
}
