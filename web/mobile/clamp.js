// Texto longo cortado em N linhas, com "ver mais" so quando de fato cortou. Usado em Pendentes e no card.
import { h } from './dom.js'

/**
 * `content` pode ser texto ou um no (um link, por exemplo). O `ResizeObserver` decide se o botao
 * aparece: texto que cabe nao ganha botao, e girar o aparelho reavalia.
 */
export function clampedText(tag, className, content, lines, { toggle = true } = {}) {
  const body = h(tag, { class: `${className} m-clamp`, style: `--lines:${lines}` }, content)
  if (!toggle) return h('div', { class: `m-clamp-wrap ${className}-wrap` }, body)
  const more = h('button', { type: 'button', class: 'm-more', hidden: true, 'aria-expanded': 'false' }, 'ver mais')
  more.addEventListener('click', () => {
    const open = body.classList.toggle('open')
    more.setAttribute('aria-expanded', String(open))
    more.textContent = open ? 'ver menos' : 'ver mais'
  })
  new ResizeObserver(() => {
    more.hidden = !body.classList.contains('open') && body.scrollHeight <= body.clientHeight + 1
  }).observe(body)
  return h('div', { class: `m-clamp-wrap ${className}-wrap` }, body, more)
}
