// Helpers de DOM do shell mobile. Texto sempre entra por textContent/createTextNode:
// dado de card (titulo, nota) nunca vira HTML.

/** h('div', {class: 'x', dataset: {a: 1}, onclick: fn}, filho, 'texto', [lista]) */
export function h(tag, props, ...children) {
  const el = document.createElement(tag)
  for (const [key, value] of Object.entries(props ?? {})) {
    if (value == null || value === false) continue
    if (key === 'class') el.className = value
    else if (key === 'dataset') Object.assign(el.dataset, value)
    else if (key === 'style') el.style.cssText = value
    else if (key.startsWith('on')) el.addEventListener(key.slice(2).toLowerCase(), value)
    else if (key === 'aria-label' || key.startsWith('aria-') || key === 'role' || key === 'for') el.setAttribute(key, value === true ? 'true' : value)
    else if (key in el) el[key] = value
    else el.setAttribute(key, value === true ? '' : value)
  }
  el.append(...children.flat(Infinity).filter((child) => child != null && child !== false))
  return el
}

/** SVG de icone a partir de um trecho fixo do codigo (nunca de dado). */
export function icon(paths) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('viewBox', '0 0 24 24')
  svg.setAttribute('aria-hidden', 'true')
  svg.setAttribute('focusable', 'false')
  svg.innerHTML = paths
  return svg
}

/**
 * Reconcilia uma lista mantendo os nos que nao mudaram: um poll de 20 s nao pode
 * destruir o campo em que o Diego esta digitando. `signature` decide se o no e reaproveitado.
 */
export function reconcile(container, items, { key, signature, create }) {
  const existing = new Map([...container.children].map((el) => [el.dataset.key, el]))
  const wanted = items.map((item) => {
    const k = String(key(item))
    const sig = signature(item)
    const old = existing.get(k)
    if (old && old.dataset.sig === sig) return old
    const el = create(item)
    el.dataset.key = k
    el.dataset.sig = sig
    return el
  })
  const same = wanted.length === container.children.length && wanted.every((el, i) => container.children[i] === el)
  if (!same) container.replaceChildren(...wanted)
}

const TIME = { hour: '2-digit', minute: '2-digit' }
const DATE_TIME = { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }

/** "14:52" se for hoje, "28/09 14:52" senao (horario local do aparelho). */
export function formatWhen(iso) {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  const today = new Date().toDateString() === date.toDateString()
  return date.toLocaleString('pt-BR', today ? TIME : DATE_TIME).replace(',', '')
}
