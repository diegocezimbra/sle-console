/**
 * Apoio dos testes de interface do celular (CARD-094): projeto de cards em disco, daemon isolado
 * (chat e estado em pastas temporarias, para nao tocar o 00-DEUS de verdade) e Chrome em modo celular.
 */
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { criarDaemon } from '../../src/daemon.js'
import { abrirBrowser } from './browser.js'

const ENV_KEYS = ['CONSOLE_CHAT_DIR', 'CONSOLE_STATE_DIR']

/** `card(coluna, id, frontmatter, corpo)` grava um card em `cards/<coluna>/<id>.md`. */
export function criarProjeto() {
  const projeto = mkdtempSync(join(tmpdir(), 'sle-m-'))
  const card = (coluna, id, front = '', corpo = '') => {
    mkdirSync(join(projeto, 'cards', coluna), { recursive: true })
    writeFileSync(join(projeto, 'cards', coluna, `${id}.md`), `---\nid: ${id}\nstatus: ${coluna}\n${front}\n---\n${corpo}\n`)
  }
  return { projeto, card }
}

/** Sobe o daemon e o Chrome-celular; devolve `{ base, browser, fechar }`. */
export async function subirCelular({ projeto, chat = [], largura = 390, altura = 844 }) {
  const anterior = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]))
  const chatDir = mkdtempSync(join(tmpdir(), 'sle-mchat-'))
  mkdirSync(join(chatDir, 'chat'), { recursive: true })
  if (chat.length) writeFileSync(join(chatDir, 'chat', `${new Date().toISOString().slice(0, 10)}.jsonl`), chat.map((m) => `${JSON.stringify(m)}\n`).join(''))
  process.env.CONSOLE_CHAT_DIR = chatDir
  process.env.CONSOLE_STATE_DIR = mkdtempSync(join(tmpdir(), 'sle-mstate-'))

  const d = criarDaemon({ dados: mkdtempSync(join(tmpdir(), 'sle-mbd-')), projeto })
  await new Promise((r) => d.servidor.listen(0, '127.0.0.1', r))
  const base = `http://127.0.0.1:${d.servidor.address().port}`
  const browser = await abrirBrowser()
  await browser.celular(largura, altura)
  return {
    base,
    browser,
    async fechar() {
      await browser?.fechar()
      await new Promise((r) => (d.observador.parar(), d.servidor.closeAllConnections(), d.servidor.close(r)))
      for (const k of ENV_KEYS) {
        if (anterior[k] === undefined) delete process.env[k]
        else process.env[k] = anterior[k]
      }
    },
  }
}

const esperarMs = (ms) => new Promise((r) => setTimeout(r, ms))

/** Espera o elemento parar de andar (scroll suave, painel deslizando): o toque acerta onde ele vai ficar. */
async function esperarParado(browser, selector) {
  const rect = () => browser.avaliar(`(() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return [r.x, r.y, r.width, r.height].map(Math.round).join() })()`)
  let anterior = await rect()
  for (let i = 0; i < 40; i++) {
    await esperarMs(60)
    const atual = await rect()
    if (atual === anterior) return
    anterior = atual
  }
}

/** Toque de verdade (CDP): prova que nada cobre o alvo, coisa que `.click()` nao prova. */
export async function tocar(browser, selector) {
  const q = `document.querySelector(${JSON.stringify(selector)})`
  await browser.avaliar(`${q}.scrollIntoView({ block: 'center', inline: 'nearest' })`)
  await esperarParado(browser, selector)
  const { x, y } = await browser.avaliar(`(() => { const r = ${q}.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 } })()`)
  await browser.chamar('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] })
  await browser.chamar('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
}

/**
 * Arrasta o dedo na horizontal (negativo = para a esquerda) em passos de 16 ms, como um toque real.
 * (`Input.synthesizeScrollGesture` com `touch` nao rola neste Chrome headless; os eventos de toque sim.)
 */
export async function deslizar(browser, { x = 320, y = 420, dx = -260, passos = 12 } = {}) {
  await browser.chamar('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] })
  for (let i = 1; i <= passos; i++) {
    await browser.chamar('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + (dx * i) / passos, y }] })
    await esperarMs(16)
  }
  await browser.chamar('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
}
