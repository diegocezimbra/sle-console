// Barra de abas do rodape: Chat · Pendentes · Quadro · Busca. Usada pelo shell mobile e pela
// pagina /chat (que e um documento a parte). Sao links de verdade: abrir em outra guia funciona.
import { h, icon } from './dom.js'

const ICONS = {
  chat: '<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1.1-4.6A8 8 0 1 1 21 12z"/>',
  pending: '<path d="M4 13l2-8h12l2 8v6H4z"/><path d="M4 13h5l1 2h4l1-2h5"/>',
  board: '<rect x="3" y="4" width="5" height="16" rx="1"/><rect x="10" y="4" width="5" height="10" rx="1"/><rect x="17" y="4" width="4" height="13" rx="1"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>',
}

export const TABS = [
  { id: 'chat', label: 'Chat', href: '/chat' },
  { id: 'pending', label: 'Pendentes', href: '/pending' },
  { id: 'board', label: 'Quadro', href: '/board' },
  { id: 'search', label: 'Busca', href: '/search' },
]

const isPlainClick = (event) => event.button === 0 && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey

/**
 * Monta as abas em `nav`. `onSelect(tab)` troca de tela sem recarregar; sem ele (ou para o
 * Chat, que e outra pagina) o link navega normalmente.
 */
export function mountTabs(nav, { active, onSelect } = {}) {
  const links = new Map()
  for (const tab of TABS) {
    const badge = h('span', { class: 'm-badge', dataset: { badge: tab.id }, 'aria-hidden': 'true', hidden: true })
    const link = h('a', { class: 'm-tab', href: tab.href, dataset: { tab: tab.id } }, icon(ICONS[tab.id]), h('span', { class: 'm-tab-label' }, tab.label), badge)
    link.addEventListener('click', (event) => {
      if (!onSelect || tab.id === 'chat' || !isPlainClick(event)) return
      event.preventDefault()
      onSelect(tab)
    })
    links.set(tab.id, { link, badge, tab })
    nav.append(link)
  }
  nav.setAttribute('role', 'navigation')
  nav.setAttribute('aria-label', 'Navegação principal')

  function setActive(id) {
    for (const [tabId, { link }] of links) {
      if (tabId === id) link.setAttribute('aria-current', 'page')
      else link.removeAttribute('aria-current')
    }
  }

  /** `{chat, pending, board}`; zero/ausente esconde o selo. O nome acessivel da aba leva o numero. */
  function setBadges(values) {
    for (const [id, { link, badge, tab }] of links) {
      const n = Number(values[id] ?? 0)
      badge.hidden = !(n > 0)
      badge.textContent = n > 99 ? '99+' : String(n)
      link.setAttribute('aria-label', n > 0 ? `${tab.label}, ${n}` : tab.label)
    }
  }

  setActive(active)
  return { setActive, setBadges }
}
