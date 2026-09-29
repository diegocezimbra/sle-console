// Shell do celular (CARD-094): barra de abas no rodape + uma tela por vez, e o card em tela cheia
// por cima de tudo. Roda no lugar do app.js quando a tela e pequena (o script do index.html decide).
import { countUnreadChat } from './counters.js'
import { formatWhen } from './dom.js'
import { mountPending } from './pending.js'
import { registerServiceWorker, showUpdateBanner } from './pwa.js'
import { counts, refresh, startPolling, state, subscribe } from './store.js'
import { mountTabs, TABS } from './tabbar.js'

const $ = (id) => document.getElementById(id)
const CHAT_POLL_MS = 30_000

let toastTimer
export function toast(message) {
  const el = $('m-toast')
  el.textContent = message
  el.hidden = false
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => { el.hidden = true }, 2600)
}

/** Pendentes abre na hora; Quadro, Busca e o card so baixam o codigo quando sao abertos. */
const SCREENS = {
  pending: { title: 'Pendentes', load: async () => mountPending },
  board: { title: 'Quadro', load: () => import('./board.js').then((m) => m.mountBoard) },
  search: { title: 'Busca', load: () => import('./search.js').then((m) => m.mountSearch) },
}
const PATH_OF = Object.fromEntries(TABS.map((tab) => [tab.id, tab.href]))
const CARD_PATH = /^\/card\/([^/]+)$/
function cardIdOf(pathname) {
  const match = CARD_PATH.exec(pathname)
  return match ? decodeURIComponent(match[1]) : null
}

/** `/` e rota desconhecida abrem Pendentes (aba inicial); um link direto de card abre o Quadro por baixo. */
function screenFromPath(pathname) {
  if (pathname === '/board' || cardIdOf(pathname)) return 'board'
  return pathname === '/search' ? 'search' : 'pending'
}

let current = null
let showToken = 0
let chatUnread = 0
const tabs = mountTabs($('m-tabs'), { active: screenFromPath(location.pathname), onSelect: (tab) => navigate(PATH_OF[tab.id]) })

const setActions = (node) => $('m-top-actions').replaceChildren(...(node ? [node] : []))

function updateBadges() {
  tabs.setBadges({ ...counts(), chat: chatUnread })
  const offline = $('m-offline')
  offline.hidden = !state.offline
  offline.textContent = `Sem conexão: mostrando o último estado${state.cachedAt ? ` (${formatWhen(state.cachedAt)})` : ''}.`
}

/** Service worker: cache para abrir sem rede e push. Sem ele o app funciona igual, so nao abre offline. */
registerServiceWorker({ onUpdate: showUpdateBanner })

/** O botao "Avisos" so aparece onde o aparelho suporta push, e depois que o service worker esta ativo. */
async function addNotificationButton(token) {
  if (!('serviceWorker' in navigator)) return
  const registration = await Promise.race([navigator.serviceWorker.ready, new Promise((resolve) => setTimeout(() => resolve(null), 4000))])
  if (!registration || token !== showToken) return
  const { notificationButton } = await import('./notifications.js')
  const button = await notificationButton({ registration, toast })
  if (button && token === showToken) setActions(button)
}

// ── Card em tela cheia ─────────────────────────────────────────────────────
let cardView = null
let openerBeforeCard = null

/** Abre o card empilhando historico: o botao voltar do sistema fecha o card e devolve a tela de onde veio. */
export function openCard(id) {
  openerBeforeCard = document.activeElement
  history.pushState({ viaApp: true }, '', `/card/${encodeURIComponent(id)}`)
  showCard(id)
}

/** Seta voltar: se o card foi aberto por dentro do app, e o voltar do navegador; se veio de link, cai no Quadro. */
function goBack() {
  if (history.state?.viaApp) return history.back()
  history.replaceState({}, '', '/board')
  hideCard()
  if (current?.id !== 'board') show('board')
}

async function showCard(id) {
  const layer = $('m-card')
  cardView?.destroy?.()
  cardView = null
  layer.hidden = false
  document.documentElement.dataset.cardOpen = ''
  $('m-app').inert = true
  const { mountCard } = await import('./card.js')
  if (layer.hidden) return // fechou enquanto o codigo baixava
  cardView = mountCard(layer, { id, toast, back: goBack, refresh })
}

function hideCard() {
  const layer = $('m-card')
  if (layer.hidden) return
  cardView?.destroy?.()
  cardView = null
  layer.hidden = true
  layer.replaceChildren()
  delete document.documentElement.dataset.cardOpen
  $('m-app').inert = false
  const opener = openerBeforeCard
  openerBeforeCard = null
  if (opener?.isConnected) opener.focus({ preventScroll: true })
}

document.addEventListener('keydown', (event) => { if (event.key === 'Escape' && !$('m-card').hidden) goBack() })

// ── Telas ──────────────────────────────────────────────────────────────────
async function show(id) {
  const token = ++showToken
  current?.destroy?.()
  current = { id, destroy: null }
  const screen = SCREENS[id]
  $('m-title').textContent = screen.title
  document.title = `${screen.title} · SLE Console`
  tabs.setActive(id)
  setActions(null)
  const root = $('m-screen')
  delete root.dataset.layout
  root.scrollTop = 0
  const mount = await screen.load()
  if (token !== showToken) return // outra aba abriu enquanto o codigo baixava
  current = { id, destroy: mount(root, { toast, setActions, openCard })?.destroy }
  if (id === 'pending') addNotificationButton(token)
}

function navigate(path) {
  if (location.pathname !== path) history.pushState({}, '', path)
  return show(screenFromPath(path))
}

async function tickChat() {
  if (document.visibilityState !== 'visible') return
  chatUnread = await countUnreadChat()
  updateBadges()
}

subscribe(updateBadges)
addEventListener('popstate', () => {
  const id = cardIdOf(location.pathname)
  if (id) return showCard(id)
  hideCard()
  const screen = screenFromPath(location.pathname)
  if (screen !== current?.id) show(screen)
})
document.addEventListener('visibilitychange', tickChat)

const initial = screenFromPath(location.pathname)
if (location.pathname === '/') history.replaceState({}, '', `${PATH_OF[initial]}${location.search}`)
show(initial)
const linkedCard = cardIdOf(location.pathname)
if (linkedCard) showCard(linkedCard)
startPolling()
tickChat()
setInterval(tickChat, CHAT_POLL_MS)
refresh().finally(() => { document.body.dataset.pronto = 'sim' })
