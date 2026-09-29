// Aba Pendentes: os cards em `pendente-diego` por prioridade, cada um com a pergunta e um
// botao por opcao. Tocar numa opcao ja registra a resposta (mesmo caminho do desktop).
import { answerCard } from './api.js'
import { clampedText, measureClamps } from './clamp.js'
import { afterPaint, formatWhen, h, reconcile } from './dom.js'
import { priorityChip, priorityTone } from './priority.js'
import { column, refresh, state, subscribe } from './store.js'

/** "perdoa <ids>" e "outra" pedem texto: o toque prepara o campo em vez de enviar sozinho. */
const NEEDS_TEXT = /<[^>]+>|^outr[ao]s?\b/i

function answeredView(card, answered, onAgain) {
  const what = [answered.option, answered.text].filter(Boolean).join(' — ')
  return h('div', { class: 'm-answered', role: 'status', tabindex: '-1' },
    h('span', { class: 'm-check', 'aria-hidden': 'true' }, '✓'),
    h('span', { class: 'm-answered-text' }, `respondido${what ? `: ${what}` : ''}`),
    h('span', { class: 'm-when' }, formatWhen(answered.at)),
    h('button', { type: 'button', class: 'm-again', onclick: onAgain }, 'responder de novo'))
}

function answerForm(card, options, toast) {
  const error = h('p', { class: 'm-error', role: 'alert', hidden: true })
  const input = h('input', {
    type: 'text', class: 'm-free', name: 'text', autocomplete: 'off', enterkeyhint: 'send',
    placeholder: options.length ? 'Outra resposta ou detalhe…' : 'Sua resposta…', 'aria-label': `Resposta em texto livre para ${card.id}`,
  })
  const send = h('button', { type: 'submit', class: 'm-send' }, 'Enviar')
  const buttons = options.map((option) => h('button', { type: 'button', class: 'm-opt', dataset: { option } }, option))
  const form = h('form', { class: 'm-answer', novalidate: true },
    buttons.length ? h('div', { class: 'm-options', role: 'group', 'aria-label': `Opções para ${card.id}` }, buttons) : null,
    h('div', { class: 'm-free-row' }, input, send), error)

  const setBusy = (busy, chosen) => {
    form.setAttribute('aria-busy', String(busy))
    for (const control of [...buttons, input, send]) control.disabled = busy
    chosen?.classList.toggle('sending', busy)
  }
  async function submit({ option = '', text = '' }, chosen) {
    if (!option && !text) return
    error.hidden = true
    setBusy(true, chosen)
    try {
      await answerCard(card.id, { option, text })
      toast('Resposta enviada')
      await refresh()
      document.querySelector(`[data-card="${CSS.escape(card.id)}"] .m-answered`)?.focus()
    } catch (e) {
      setBusy(false, chosen)
      error.textContent = e instanceof TypeError ? 'Sem conexão: a resposta não foi enviada.' : `Não enviou: ${e.message}`
      error.hidden = false
    }
  }
  for (const button of buttons) {
    button.addEventListener('click', () => {
      const option = button.dataset.option
      if (NEEDS_TEXT.test(option)) {
        // "perdoa <ids>" deixa "perdoa " no campo para completar; "outra" deixa o campo limpo.
        const start = option.replace(/<[^>]*>/g, '').trim()
        input.value = /^outr[ao]s?$/i.test(start) ? '' : `${start} `
        input.focus()
        return
      }
      submit({ option, text: input.value.trim() }, button)
    })
  }
  form.addEventListener('submit', (event) => {
    event.preventDefault()
    submit({ text: input.value.trim() }, send)
  })
  return form
}

/** Link para o card: clique comum abre por dentro do app (sem recarregar); o resto segue como link normal. */
function cardLink(card, className, content, openCard) {
  const link = h('a', { class: className, href: `/card/${encodeURIComponent(card.id)}` }, content)
  if (openCard) {
    link.addEventListener('click', (event) => {
      if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return
      event.preventDefault()
      openCard(card.id)
    })
  }
  return link
}

function buildItem(card, toast, openCard) {
  const q = card.question ?? { text: null, options: [], source: null, answered: null }
  // Quando a pergunta E o titulo (o DEUS escreve assim), o titulo mostra mais linhas: sem
  // o contexto na tela, as opcoes ("corta no deploy") nao dizem o que vao fazer.
  const titleLines = q.source === 'title' ? 6 : 2
  const controls = h('div', { class: 'm-controls' })
  const showForm = () => controls.replaceChildren(answerForm(card, q.options, toast))
  if (q.answered) controls.append(answeredView(card, q.answered, showForm))
  else showForm()
  // `append(null)` escreveria a palavra "null": os filhos opcionais passam por `h`, que os descarta.
  return h('li', { class: 'm-pend', dataset: { card: card.id, tone: priorityTone(card.prioridade) } },
    h('div', { class: 'm-pend-meta' },
      cardLink(card, 'm-id', card.id, openCard),
      priorityChip(card.prioridade, { withLabel: true }),
      card.projectLabel ? h('span', { class: 'm-proj' }, card.projectLabel) : null),
    // Com a pergunta numa caixa propria, o titulo e so contexto: 2 linhas, sem "ver mais".
    clampedText('h2', 'm-pend-title', cardLink(card, 'm-title-link', card.title ?? '', openCard), titleLines, { toggle: !q.text }),
    q.text ? clampedText('p', 'm-question', q.text, 5) : null,
    controls)
}

const FIRST_PAINT_ITEMS = 3
const REST_CHUNK = 4
let renderRun = 0
const signature = (card) => JSON.stringify([card.id, card.title, card.prioridade, card.projectLabel, card.question])

function skeleton() {
  return h('div', { class: 'm-skeleton', 'aria-hidden': 'true' }, ...[0, 1, 2].map(() => h('div', { class: 'm-skel-card' })))
}

export function mountPending(root, { toast, openCard }) {
  const list = h('ul', { class: 'm-list', 'aria-label': 'Cards esperando você' })
  const empty = h('div', { class: 'm-empty', hidden: true },
    h('p', { class: 'm-empty-title' }, 'Nada esperando por você'),
    h('p', { class: 'm-empty-sub' }, 'Quando um card precisar de uma decisão sua, ele aparece aqui.'))
  const loading = skeleton()
  const failed = h('div', { class: 'm-empty', hidden: true },
    h('p', { class: 'm-empty-title' }, 'Não consegui carregar'),
    h('button', { type: 'button', class: 'm-retry', onclick: () => refresh() }, 'Tentar de novo'))
  root.replaceChildren(loading, list, empty, failed)

  function render() {
    const cards = column('pendente-diego')
    loading.hidden = state.loaded || state.offline
    failed.hidden = state.loaded || !state.offline
    list.hidden = cards.length === 0
    empty.hidden = !state.loaded || cards.length > 0
    // 1a vez: so os itens que cabem na tela entram na 1a tarefa (e sao medidos, sem "ver mais" tardio); o
    // resto entra logo depois do paint. Montar 16 cards de uma vez custava 350 ms de layout com a CPU lenta.
    const options = { key: (c) => c.id, signature, create: (c) => buildItem(c, toast, openCard) }
    const firstPaint = list.children.length === 0 && cards.length > FIRST_PAINT_ITEMS
    const mine = ++renderRun
    reconcile(list, firstPaint ? cards.slice(0, FIRST_PAINT_ITEMS) : cards, options)
    measureClamps(list)
    // O resto entra em lotes pequenos, um por paint: cada tarefa fica curta e a tela nao trava.
    const more = (from) => afterPaint(() => {
      if (mine !== renderRun) return // um render mais novo assumiu
      const all = column('pendente-diego')
      reconcile(list, all.slice(0, from + REST_CHUNK), options)
      measureClamps(list)
      if (from + REST_CHUNK < all.length) more(from + REST_CHUNK)
    })
    if (firstPaint) more(FIRST_PAINT_ITEMS)
  }
  const unsubscribe = subscribe(render)
  render()
  return { destroy: unsubscribe }
}
