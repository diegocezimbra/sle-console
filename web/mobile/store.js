// Estado do celular: o resumo do board, atualizado por poll (o daemon nao empurra mudanca de
// arquivo) e por foco/volta da rede. Guarda o ultimo estado bom: sem rede, a tela mostra o
// que tinha e diz que esta desatualizada em vez de esvaziar.
import { CARDS_SUMMARY_PATH, withAllProjects } from './api.js'

const POLL_MS = 20_000

export const state = { board: {}, total: 0, loaded: false, offline: false, cachedAt: null }
const listeners = new Set()
let lastText = ''
let inflight = null
let timer = null

export function subscribe(listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
const notify = () => listeners.forEach((listener) => listener(state))

export const column = (name) => state.board[name] ?? []

/** Numeros das abas: cards esperando o Diego e cards em review + testando. */
export function counts() {
  return { pending: column('pendente-diego').length, board: column('review').length + column('testando').length }
}

/** A consulta que o index.html ja disparou (em paralelo com os modulos) vale uma vez. */
function takePrefetched() {
  const promise = window.__cardsPromise
  window.__cardsPromise = null
  return promise ? promise.catch(() => null) : null
}

async function load() {
  try {
    const response = (await takePrefetched()) ?? (await fetch(withAllProjects(CARDS_SUMMARY_PATH)))
    if (!response.ok) throw new Error(`erro ${response.status}`)
    const text = await response.text()
    // O service worker devolve o ultimo estado bom quando a rede cai e marca a resposta com x-sle-offline.
    const fromCache = response.headers.get('x-sle-offline') === '1'
    if (text === lastText && state.loaded && state.offline === fromCache) return
    lastText = text
    const data = JSON.parse(text)
    Object.assign(state, { board: data.board ?? {}, total: data.total ?? 0, loaded: true, offline: fromCache, cachedAt: fromCache ? response.headers.get('x-sle-cached-at') : null })
  } catch {
    state.offline = true
  }
  notify()
}

/** Uma consulta por vez: chamadas concorrentes esperam a que ja esta no ar. */
export function refresh() {
  inflight ??= load().finally(() => {
    inflight = null
  })
  return inflight
}

export function startPolling() {
  const tick = () => {
    if (document.visibilityState === 'visible') refresh()
  }
  timer ??= setInterval(tick, POLL_MS)
  document.addEventListener('visibilitychange', tick)
  addEventListener('online', refresh)
  addEventListener('offline', () => {
    state.offline = true
    notify()
  })
}
