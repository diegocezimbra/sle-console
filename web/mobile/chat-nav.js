// Pagina /chat no celular: barra de abas no rodape (o Chat e uma pagina a parte do shell), contadores
// das outras abas, "visto" das mensagens (zera o contador do Chat) e a pagina acompanhando a area
// visivel quando o teclado abre. Em tela grande nao faz nada: o desktop nao tem barra de abas.
import { fetchCardCounts, markChatSeen } from './counters.js'
import { mountTabs } from './tabbar.js'
import { fitToVisualViewport } from './viewport.js'

const CARD_POLL_MS = 30_000
const MOBILE = matchMedia('(max-width: 767px), (pointer: coarse) and (max-height: 500px)')

function start() {
  // No celular o Enter do teclado envia e nao ha Shift+Enter: a dica do desktop so atrapalha (e quebra em 2 linhas).
  document.getElementById('texto').placeholder = 'Mensagem para o DEUS'
  const nav = document.getElementById('m-tabs')
  nav.hidden = false
  const tabs = mountTabs(nav, { active: 'chat' })
  fitToVisualViewport(document.body)

  // Quem esta com o chat aberto viu tudo que aparece nele: guarda o ts da ultima mensagem na tela.
  const thread = document.getElementById('thread')
  const markSeen = () => {
    const last = [...thread.querySelectorAll('.msg')].at(-1)?.dataset.ts
    if (last) markChatSeen(last)
  }
  new MutationObserver(markSeen).observe(thread, { childList: true })
  markSeen()

  async function refreshBadges() {
    if (document.visibilityState !== 'visible') return
    tabs.setBadges({ ...(await fetchCardCounts()), chat: 0 }) // no proprio chat nada esta "nao lido"
  }
  refreshBadges()
  setInterval(refreshBadges, CARD_POLL_MS)
  document.addEventListener('visibilitychange', refreshBadges)
}

if (MOBILE.matches) start()
