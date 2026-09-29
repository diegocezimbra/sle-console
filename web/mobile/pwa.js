// PWA (CARD-094): registro do service worker, aviso de versao nova e o registro de push. O
// DISPARO das notificacoes e do CARD-240; aqui o aparelho so se cadastra no servidor.
import { h } from './dom.js'

/** Registra o sw.js; quando uma versao nova assume o controle, chama `onUpdate` (nao no primeiro install). */
export async function registerServiceWorker({ onUpdate } = {}) {
  if (!('serviceWorker' in navigator)) return null
  try {
    const hadController = Boolean(navigator.serviceWorker.controller)
    const registration = await navigator.serviceWorker.register('/sw.js', { scope: '/' })
    navigator.serviceWorker.addEventListener('controllerchange', () => { if (hadController) onUpdate?.() })
    return registration
  } catch {
    return null // rede/politica do navegador: o app funciona igual, so sem cache offline
  }
}

/** Faixa "Nova versao instalada": recarregar troca o JS que ja esta na tela pelo novo. */
export function showUpdateBanner() {
  if (document.querySelector('.m-update')) return
  const reload = h('button', { type: 'button', class: 'm-update-btn', onclick: () => location.reload() }, 'Recarregar')
  document.body.append(h('div', { class: 'm-update', role: 'status' }, h('span', {}, 'Nova versão instalada.'), reload))
}

export const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
export const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true
export const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window

/**
 * `available` (pode ativar) · `subscribed` · `denied` (bloqueado no navegador) ·
 * `needs-install` (iPhone: push so existe no app da tela de inicio) · `unsupported`.
 */
export async function pushState(registration) {
  if (isIos() && !isStandalone()) return 'needs-install'
  if (!pushSupported() || !registration) return 'unsupported'
  if (Notification.permission === 'denied') return 'denied'
  const subscription = await registration.pushManager.getSubscription()
  return subscription && Notification.permission === 'granted' ? 'subscribed' : 'available'
}

function keyBytes(base64url) {
  const padded = base64url.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(base64url.length / 4) * 4, '=')
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0))
}

export function deviceLabel() {
  const ua = navigator.userAgent
  const kind = /iphone/i.test(ua) ? 'iPhone' : /ipad/i.test(ua) ? 'iPad' : /android/i.test(ua) ? 'Android' : 'Computador'
  return `${kind}${isStandalone() ? ' (app)' : ''}`
}

/** Pede permissao (precisa ser num toque do usuario), assina no navegador e cadastra o aparelho no servidor. */
export async function enablePush(registration) {
  if (await Notification.requestPermission() !== 'granted') return { ok: false, reason: 'denied' }
  const { publicKey } = await (await fetch('/api/push/key')).json()
  const options = { userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) }
  let subscription
  try {
    subscription = await registration.pushManager.subscribe(options)
  } catch {
    // Assinatura antiga com outra chave VAPID (o servidor trocou o par): descarta e tenta uma vez de novo.
    await (await registration.pushManager.getSubscription())?.unsubscribe()
    subscription = await registration.pushManager.subscribe(options)
  }
  const response = await fetch('/api/push/subscribe', { method: 'POST', body: JSON.stringify({ subscription: subscription.toJSON(), label: deviceLabel() }) })
  if (!response.ok) {
    await subscription.unsubscribe().catch(() => {})
    return { ok: false, reason: 'server' }
  }
  return { ok: true }
}

export async function disablePush(registration) {
  const subscription = await registration.pushManager.getSubscription()
  if (!subscription) return
  await fetch('/api/push/unsubscribe', { method: 'POST', body: JSON.stringify({ endpoint: subscription.endpoint }) }).catch(() => {})
  await subscription.unsubscribe().catch(() => {})
}
