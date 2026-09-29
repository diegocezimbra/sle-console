// Aba Busca: acha card por id, titulo, projeto ou texto (o servidor procura no corpo). Sem
// termo, mostra os cards mexidos por ultimo -- o atalho para "aquele card de ontem".
import { getJson } from './api.js'
import { h, reconcile } from './dom.js'
import { BOARD_ORDER, cardRow, rowSignature } from './rows.js'
import { column, subscribe } from './store.js'

const DEBOUNCE_MS = 250
const RECENT_LIMIT = 20

const recentCards = () => BOARD_ORDER.flatMap((name) => column(name))
  .sort((a, b) => String(b.modificado ?? '').localeCompare(String(a.modificado ?? '')))
  .slice(0, RECENT_LIMIT)

export function mountSearch(root, ctx) {
  const input = h('input', {
    type: 'search', class: 'm-search-input', name: 'q', autocomplete: 'off', autocapitalize: 'off', spellcheck: false,
    enterkeyhint: 'search', placeholder: 'Buscar por id, título, projeto ou texto', 'aria-label': 'Buscar cards',
    value: new URL(location.href).searchParams.get('q') ?? '',
  })
  const form = h('form', { class: 'm-search', role: 'search' }, input)
  const status = h('p', { class: 'm-search-status', role: 'status', 'aria-live': 'polite' })
  const list = h('div', { class: 'm-search-list' })
  root.replaceChildren(form, status, list)

  let seq = 0
  let results = null // null = mostrando os recentes
  function paint(cards, options) {
    reconcile(list, cards, { key: (c) => c.id, signature: rowSignature, create: (c) => cardRow(c, { ...options, onOpen: ctx.openCard }) })
  }
  function showRecent() {
    results = null
    const cards = recentCards()
    status.textContent = cards.length ? 'Mexidos por último' : ''
    paint(cards, { showColumn: true })
  }
  async function run() {
    const term = input.value.trim()
    const mine = ++seq
    const url = new URL(location.href)
    if (term) url.searchParams.set('q', term)
    else url.searchParams.delete('q')
    history.replaceState(history.state, '', url.pathname + url.search)
    if (!term) return showRecent()
    status.textContent = 'Buscando…'
    try {
      const body = await getJson(`/api/search?q=${encodeURIComponent(term)}`)
      if (mine !== seq) return // uma busca mais nova ja saiu
      results = body.results
      status.textContent = results.length ? `${results.length} ${results.length === 1 ? 'resultado' : 'resultados'}` : `Nada encontrado para “${term}”`
      paint(results, { showColumn: true, showSnippet: true })
    } catch {
      if (mine === seq) status.textContent = 'Não consegui buscar agora. Tente de novo.'
    }
  }

  let timer
  input.addEventListener('input', () => {
    clearTimeout(timer)
    timer = setTimeout(run, DEBOUNCE_MS)
  })
  form.addEventListener('submit', (event) => {
    event.preventDefault()
    clearTimeout(timer)
    run()
    input.blur() // fecha o teclado: o resultado e o que interessa
  })

  const unsubscribe = subscribe(() => { if (results === null && !input.value.trim()) showRecent() })
  if (input.value.trim()) run()
  else showRecent()
  requestAnimationFrame(() => { if (!input.value) input.focus() })
  return { destroy() { unsubscribe(); clearTimeout(timer) } }
}
