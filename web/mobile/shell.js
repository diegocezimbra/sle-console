// Shell do celular (CARD-094): barra de abas no rodape + uma tela por vez. Roda no lugar do
// app.js quando a tela e pequena (a escolha e feita pelo script do index.html).
import { countUnreadChat } from './counters.js'
import { h } from './dom.js'
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

/** Tela ainda nao entregue: diz isso e deixa uma saida para a versao completa. */
function mountSoon(root) {
  root.replaceChildren(h('div', { class: 'm-empty' },
    h('p', { class: 'm-empty-title' }, 'Chega na próxima entrega'),
    h('p', { class: 'm-empty-sub' }, 'Por enquanto, a versão completa abre aqui:'),
    h('a', { class: 'm-retry', href: `${location.pathname}?desktop=1` }, 'Abrir versão completa')))
  return {}
}

const SCREENS = {
  pending: { title: 'Pendentes', mount: mountPending },
  board: { title: 'Quadro', mount: mountSoon },
  search: { title: 'Busca', mount: mountSoon },
}
const PATH_OF = Object.fromEntries(TABS.map((tab) => [tab.id, tab.href]))

/** `/` e qualquer rota desconhecida abrem Pendentes: e a aba inicial do celular. */
function screenFromPath(pathname) {
  return pathname === '/board' ? 'board' : pathname === '/search' ? 'search' : 'pending'
}

let current = null
let chatUnread = 0
const tabs = mountTabs($('m-tabs'), { active: screenFromPath(location.pathname), onSelect: (tab) => navigate(PATH_OF[tab.id]) })

function updateBadges() {
  tabs.setBadges({ ...counts(), chat: chatUnread })
  $('m-offline').hidden = !state.offline
}

function show(id) {
  current?.instance?.destroy?.()
  const screen = SCREENS[id]
  $('m-title').textContent = screen.title
  document.title = `${screen.title} · SLE Console`
  tabs.setActive(id)
  const root = $('m-screen')
  root.scrollTop = 0
  current = { id, instance: screen.mount(root, { toast }) }
}

function navigate(path) {
  const id = screenFromPath(path)
  if (location.pathname !== path) history.pushState({}, '', path)
  show(id)
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
