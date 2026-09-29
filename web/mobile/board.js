// Aba Quadro: uma coluna por vez. As abas das colunas ficam fixas no topo (com contador) e as
// colunas sao paginas de um scroll-snap horizontal: o dedo desliza entre elas, sem JS de gesto e
// sem rolagem horizontal da pagina. Filtros de prioridade e projeto num painel deslizante.
import { h, icon, reconcile } from './dom.js'
import { activeCount, currentFilters, openFilterDrawer, passes } from './filters.js'
import { BOARD_ORDER, COLUMN_LABELS, cardRow, rowSignature } from './rows.js'
import { column, subscribe } from './store.js'

const DEFAULT_COLUMN = 'review'
const PAGE_SIZE = 40
const STORAGE_KEY = 'sle.board.coluna'
const FUNNEL = '<path d="M4 5h16l-6 8v6l-4-2v-4z"/>'

function initialColumn() {
  const fromUrl = new URL(location.href).searchParams.get('c')
  if (BOARD_ORDER.includes(fromUrl)) return fromUrl
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (BOARD_ORDER.includes(saved)) return saved
  } catch { /* armazenamento bloqueado: cai no padrao */ }
  return DEFAULT_COLUMN
}

export function mountBoard(root, ctx) {
  root.dataset.layout = 'fill'
  const filters = currentFilters()
  let active = initialColumn()
  let lockUntil = 0
  const shown = Object.fromEntries(BOARD_ORDER.map((name) => [name, PAGE_SIZE]))

  const strip = h('div', { class: 'm-col-tabs', role: 'tablist', 'aria-label': 'Colunas do quadro' })
  const pager = h('div', { class: 'm-pager' })
  const parts = new Map()
  for (const name of BOARD_ORDER) {
    const count = h('span', { class: 'm-col-count' }, '0')
    const tab = h('button', { type: 'button', role: 'tab', class: 'm-col-tab', id: `m-tab-${name}`, 'aria-controls': `m-panel-${name}`, 'aria-selected': 'false', tabindex: '-1', dataset: { col: name } }, COLUMN_LABELS[name], count)
    const list = h('div', { class: 'm-col-list' })
    const empty = h('p', { class: 'm-col-empty', hidden: true }, 'Nenhum card nesta coluna')
    const more = h('button', { type: 'button', class: 'm-more-rows', hidden: true })
    const panel = h('section', { class: 'm-col', role: 'tabpanel', id: `m-panel-${name}`, 'aria-labelledby': `m-tab-${name}`, tabindex: '0', dataset: { col: name } }, list, empty, more)
    tab.addEventListener('click', () => setActive(name, { scroll: true }))
    more.addEventListener('click', () => { shown[name] += PAGE_SIZE; render() })
    parts.set(name, { tab, count, list, empty, more })
    strip.append(tab)
    pager.append(panel)
  }
  root.replaceChildren(strip, pager)

  const filterBadge = h('span', { class: 'm-badge', hidden: true, 'aria-hidden': 'true' })
  const filterButton = h('button', { type: 'button', class: 'm-top-btn', 'aria-haspopup': 'dialog' }, icon(FUNNEL), h('span', {}, 'Filtros'), filterBadge)
  filterButton.addEventListener('click', () => openFilterDrawer({
    allCards: BOARD_ORDER.flatMap((name) => column(name)),
    onChange: render,
    opener: filterButton,
  }))
  ctx.setActions(filterButton)

  function render() {
    for (const name of BOARD_ORDER) {
      const { count, list, empty, more } = parts.get(name)
      const cards = column(name).filter((card) => passes(card, filters))
      count.textContent = String(cards.length)
      empty.hidden = cards.length > 0
      reconcile(list, cards.slice(0, shown[name]), { key: (c) => c.id, signature: rowSignature, create: (c) => cardRow(c, { onOpen: ctx.openCard }) })
      const rest = cards.length - shown[name]
      more.hidden = rest <= 0
      if (rest > 0) more.textContent = `Mostrar mais (${rest})`
    }
    const n = activeCount(filters)
    filterBadge.hidden = n === 0
    filterBadge.textContent = String(n)
    filterButton.setAttribute('aria-label', n ? `Filtros, ${n} ativo${n > 1 ? 's' : ''}` : 'Filtros')
  }

  const indexOf = (name) => BOARD_ORDER.indexOf(name)
  function centerTab(name) {
    const { tab } = parts.get(name)
    strip.scrollTo({ left: tab.offsetLeft - (strip.clientWidth - tab.offsetWidth) / 2, behavior: 'smooth' })
  }
  function setActive(name, { scroll = false, smooth = true } = {}) {
    active = name
    for (const [other, { tab }] of parts) {
      tab.setAttribute('aria-selected', String(other === name))
      tab.tabIndex = other === name ? 0 : -1
    }
    centerTab(name)
    try { localStorage.setItem(STORAGE_KEY, name) } catch { /* sem armazenamento: so nao lembra */ }
    const url = new URL(location.href)
    url.searchParams.set('c', name)
    history.replaceState(history.state, '', url.pathname + url.search)
    if (scroll) {
      lockUntil = Date.now() + 500 // o scroll suave passa por colunas intermediarias: nao deixa a aba pular
      pager.scrollTo({ left: indexOf(name) * pager.clientWidth, behavior: smooth ? 'smooth' : 'auto' })
    }
  }

  let frame = 0
  pager.addEventListener('scroll', () => {
    if (frame) return
    frame = requestAnimationFrame(() => {
      frame = 0
      if (Date.now() < lockUntil) return
      const index = Math.min(Math.max(Math.round(pager.scrollLeft / pager.clientWidth), 0), BOARD_ORDER.length - 1)
      if (BOARD_ORDER[index] !== active) setActive(BOARD_ORDER[index])
    })
  }, { passive: true })
  strip.addEventListener('keydown', (event) => {
    const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0
    const next = BOARD_ORDER[indexOf(active) + step]
    if (!step || !next) return
    event.preventDefault()
    setActive(next, { scroll: true })
    parts.get(next).tab.focus()
  })
  const onResize = () => pager.scrollTo({ left: indexOf(active) * pager.clientWidth, behavior: 'auto' })
  addEventListener('resize', onResize)

  const unsubscribe = subscribe(render)
  render()
  requestAnimationFrame(() => setActive(active, { scroll: true, smooth: false }))
  return {
    destroy() {
      unsubscribe()
      removeEventListener('resize', onResize)
      ctx.setActions(null)
    },
  }
}
