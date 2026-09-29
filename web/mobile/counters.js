// Numeros das abas que nao dependem do estado do shell: mensagens do DEUS que o Diego
// ainda nao viu e o resumo do board (a pagina /chat nao tem o store do shell).
import { CARDS_SUMMARY_PATH, withAllProjects } from './api.js'

const SEEN_KEY = 'sle.chat.visto'

export function getChatSeen() {
  try {
    return localStorage.getItem(SEEN_KEY)
  } catch {
    return null
  }
}

export function markChatSeen(ts = new Date().toISOString()) {
  try {
    localStorage.setItem(SEEN_KEY, ts)
  } catch {
    /* armazenamento bloqueado (aba privada): o contador so nao persiste */
  }
}

/** Mensagens do DEUS depois da ultima vez que o chat foi aberto. Primeira vez: nada e "nao lido". */
export async function countUnreadChat() {
  const seen = getChatSeen()
  if (!seen) {
    markChatSeen()
    return 0
  }
  try {
    const response = await fetch(`/api/chat?desde=${encodeURIComponent(seen)}`)
    if (!response.ok) return 0
    const { mensagens = [] } = await response.json()
    return mensagens.filter((m) => m.de === 'deus').length
  } catch {
    return 0
  }
}

/** Pendentes e review+testando, direto do resumo (usado pela pagina de chat). */
export async function fetchCardCounts() {
  try {
    const response = await fetch(withAllProjects(CARDS_SUMMARY_PATH))
    if (!response.ok) return { pending: 0, board: 0 }
    const { board = {} } = await response.json()
    const n = (name) => board[name]?.length ?? 0
    return { pending: n('pendente-diego'), board: n('review') + n('testando') }
  } catch {
    return { pending: 0, board: 0 }
  }
}
