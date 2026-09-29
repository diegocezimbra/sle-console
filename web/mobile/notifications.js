// Botao "Avisos" do topo de Pendentes: liga e desliga o push neste aparelho.
import { h, icon } from './dom.js'
import { disablePush, enablePush, pushState } from './pwa.js'

const BELL = '<path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z"/><path d="M10 20a2 2 0 0 0 4 0"/>'
const LABEL = { available: 'Ativar avisos', subscribed: 'Avisos ativos', denied: 'Avisos bloqueados', 'needs-install': 'Avisos' }

/** `null` quando o aparelho nem tem como (sem service worker/PushManager). */
export async function notificationButton({ registration, toast }) {
  let state = await pushState(registration)
  if (state === 'unsupported') return null
  const text = h('span', {})
  const button = h('button', { type: 'button', class: 'm-top-btn m-notify' }, icon(BELL), text)
  const paint = () => {
    text.textContent = LABEL[state]
    button.setAttribute('aria-pressed', String(state === 'subscribed'))
    button.dataset.state = state
  }
  button.addEventListener('click', async () => {
    button.disabled = true
    try {
      if (state === 'needs-install') return toast('No iPhone: Compartilhar → Adicionar à Tela de Início, abra o app e ative os avisos.')
      if (state === 'denied') return toast('Libere as notificações deste site nas configurações do navegador.')
      if (state === 'subscribed') {
        await disablePush(registration)
        toast('Avisos desativados neste aparelho.')
      } else {
        const result = await enablePush(registration)
        toast(result.ok ? 'Avisos ativados neste aparelho.' : result.reason === 'denied' ? 'Permissão negada: os avisos não foram ativados.' : 'Não consegui ativar os avisos agora.')
      }
      state = await pushState(registration)
    } catch {
      toast('Não consegui mudar os avisos agora.')
    } finally {
      button.disabled = false
      paint()
    }
  })
  paint()
  return button
}
