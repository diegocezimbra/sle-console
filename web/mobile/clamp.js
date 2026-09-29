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
  more.fits = () => !body.classList.contains('open') && body.scrollHeight <= body.clientHeight + 1 // so leitura
  more.measure = () => { more.hidden = more.fits() }
  more.addEventListener('click', () => {
    const open = body.classList.toggle('open')
    more.setAttribute('aria-expanded', String(open))
    more.textContent = open ? 'ver menos' : 'ver mais'
  })
  new ResizeObserver(more.measure).observe(body) // girar o aparelho reavalia
  return h('div', { class: `m-clamp-wrap ${className}-wrap` }, body, more)
}

/**
 * Mede todos os cortes de `root` AGORA, na mesma tarefa da insercao: o "ver mais" ja nasce no estado
 * certo e o 1o paint sai completo. Deixar so para o ResizeObserver empurrava o conteudo de baixo depois
 * do paint (salto de layout medido pelo Lighthouse).
 */
export function measureClamps(root) {
  // Todas as leituras primeiro, todas as escritas depois: intercalar (le, escreve, le...) refazia o layout da pagina
  // a cada texto (426 ms de tarefa longa medidos com 16 cards em CPU 4x mais lenta).
  const buttons = [...root.querySelectorAll('.m-more')].filter((m) => m.fits)
  const hide = buttons.map((m) => m.fits())
  buttons.forEach((m, i) => { m.hidden = hide[i] })
}
