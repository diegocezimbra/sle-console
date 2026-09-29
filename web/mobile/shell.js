// Shell do celular (CARD-094): barra de abas no rodape + uma tela por vez. Roda no lugar do
// app.js quando a tela e pequena (a escolha e feita pelo script do index.html).
import { countUnreadChat } from './counters.js'
import { mountPending } from './pending.js'
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

/** Pendentes abre na hora; Quadro e Busca so baixam o codigo delas quando a aba e aberta. */
const SCREENS = {
  pending: { title: 'Pendentes', load: async () => mountPending },
  board: { title: 'Quadro', load: () => import('./board.js').then((m) => m.mountBoard) },
  search: { title: 'Busca', load: () => import('./search.js').then((m) => m.mountSearch) },
}
const PATH_OF = Object.fromEntries(TABS.map((tab) => [tab.id, tab.href]))

/** `/` e qualquer rota desconhecida abrem Pendentes: e a aba inicial do celular. */
function screenFromPath(pathname) {
  return pathname === '/board' ? 'board' : pathname === '/search' ? 'search' : 'pending'
}

let current = null
let showToken = 0
let chatUnread = 0
const tabs = mountTabs($('m-tabs'), { active: screenFromPath(location.pathname), onSelect: (tab) => navigate(PATH_OF[tab.id]) })

const setActions = (node) => $('m-top-actions').replaceChildren(...(node ? [node] : []))

function updateBadges() {
  tabs.setBadges({ ...counts(), chat: chatUnread })
  $('m-offline').hidden = !state.offline
}

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
  current = { id, destroy: mount(root, { toast, setActions })?.destroy }
}

function navigate(path) {
  const id = screenFromPath(path)
  if (location.pathname !== path) history.pushState({}, '', path)
  return show(id)
}

async function tickChat() {
  if (document.visibilityState !== 'visible') return
  chatUnread = await countUnreadChat()
  updateBadges()
}

subscribe(updateBadges)
addEventListener('popstate', () => show(screenFromPath(location.pathname)))
document.addEventListener('visibilitychange', tickChat)

const initial = screenFromPath(location.pathname)
if (location.pathname === '/') history.replaceState({}, '', `${PATH_OF[initial]}${location.search}`)
show(initial)
startPolling()
tickChat()
setInterval(tickChat, CHAT_POLL_MS)
refresh().finally(() => { document.body.dataset.pronto = 'sim' })
