// Card em tela cheia (CARD-094): voltar, titulo, a pergunta com botoes de opcao, campo de resposta
// grande e o botao Responder fixo no rodape. "Dados" e "Atividades da IA" comecam recolhidas.
import { markdownSeguro, semSecaoDeCredenciais } from '/card-md.js'
import { pintarCredenciais as mountCredentialForm } from '/credenciais.js'
import { ApiError, answerCard, getJson, postJson, withAllProjects } from './api.js'
import { clampedText, measureClamps } from './clamp.js'
import { formatWhen, h, icon } from './dom.js'
import { priorityChip } from './priority.js'
import { COLUMN_LABELS } from './rows.js'
import { column } from './store.js'
import { fitToVisualViewport } from './viewport.js'

const BACK = '<path d="M15 5l-7 7 7 7"/><path d="M8 12h12"/>'
const NEEDS_TEXT = /<[^>]+>|^outr[ao]s?\b/i
const RISK_LABEL = { baixo: 'risco baixo', medio: 'risco médio', 'médio': 'risco médio', alto: 'risco alto' }
const ANSWER_BLOCK = /## Resposta do Diego \(([^)]+)\)\n\*\*Opção:\*\* (.*)\n([\s\S]*?)(?=\n## |$)/g

/** Tira do corpo as secoes que a tela mostra em outro lugar (`## Notas`, respostas do Diego). */
function withoutSections(corpo, titles) {
  return String(corpo ?? '').split(/^(?=## )/m).filter((part) => !titles.some((t) => part.startsWith(`## ${t}`))).join('')
}

function fold(title, body, { open = false } = {}) {
  return h('details', { class: 'm-fold', open }, h('summary', {}, h('span', {}, title)), h('div', { class: 'm-fold-body' }, body))
}

/** `prazo: 6` = horas; data ISO vira data local; qualquer outra coisa segue como veio. */
function deadline(value) {
  if (typeof value === 'number') return `${value} h`
  return /^\d{4}-\d{2}-\d{2}T/.test(String(value ?? '')) ? formatWhen(value) : value
}

function metaRows(card) {
  const rows = [['Projeto', card.project], ['Responsável', card.owner], ['Modelo', card.modelo], ['Prazo', deadline(card.prazo)], ['Branch', card.branch], ['PR', card.pr],
    ['Criado', card.created ? formatWhen(card.created) : ''], ['Atualizado', card.updated ? formatWhen(card.updated) : '']]
    .filter(([, value]) => value && typeof value !== 'object')
  return h('dl', { class: 'm-meta' }, rows.map(([k, v]) => [h('dt', {}, k), h('dd', {}, String(v))]))
}

function activityList(notes) {
  if (!notes.length) return h('p', { class: 'm-muted' }, 'Nenhuma atividade registrada.')
  return h('ol', { class: 'm-activity' }, [...notes].reverse().map((n) =>
    h('li', {}, h('time', { dateTime: n.ts }, formatWhen(n.ts)), h('span', {}, n.text))))
}

function previousAnswers(corpo) {
  const blocks = [...String(corpo ?? '').matchAll(ANSWER_BLOCK)].reverse()
  if (!blocks.length) return null
  return h('section', { class: 'm-prev' }, h('h2', { class: 'm-h2' }, 'Respostas anteriores'),
    blocks.map(([, when, option, text]) => h('p', { class: 'm-prev-item' },
      h('b', {}, `${formatWhen(when.replace(' ', 'T') + ':00Z')} — ${option.trim() === '—' ? 'sem opção' : option.trim()}`), text.trim() ? h('span', {}, text.trim()) : null)))
}

export function mountCard(layer, { id, toast, back, refresh, comProjeto = withAllProjects }) {
  const stopFit = fitToVisualViewport(layer)
  const summary = ['pendente-diego', 'review', 'testando', 'doing', 'backlog', 'aprovado', 'done', 'refinamento', 'recurring'].flatMap((c) => column(c)).find((c) => c.id === id)
  const backButton = h('button', { type: 'button', class: 'm-back', 'aria-label': 'Voltar', onclick: back }, icon(BACK))
  const columnChip = h('span', { class: 'm-chip m-col-chip', hidden: !summary }, summary ? COLUMN_LABELS[summary.coluna] ?? summary.coluna : '')
  const body = h('div', { class: 'm-card-body' }, h('div', { class: 'm-skeleton', 'aria-hidden': 'true' }, h('div', { class: 'm-skel-card' })))
  const respond = h('button', { type: 'button', class: 'm-respond', disabled: true }, 'Responder')
  const resolve = h('button', { type: 'button', class: 'm-resolve', hidden: true }, '✔ Resolvida')
  layer.replaceChildren(
    h('div', { class: 'm-card-top' }, backButton, h('span', { class: 'm-card-topid' }, id), columnChip),
    body,
    h('div', { class: 'm-card-foot' }, respond, resolve))
  layer.setAttribute('role', 'dialog')
  layer.setAttribute('aria-modal', 'true')

  let card = null
  let selected = ''
  const textarea = h('textarea', { class: 'm-answer-text', rows: 6, maxLength: 1_000_000, name: 'text', placeholder: 'Escreva sua resposta…', 'aria-label': 'Sua resposta' })
  const message = h('p', { class: 'm-error', role: 'alert', hidden: true })

  function optionButtons(options) {
    const buttons = options.map((option) => h('button', { type: 'button', class: 'm-opt', 'aria-pressed': 'false', dataset: { option } }, option))
    for (const button of buttons) {
      button.addEventListener('click', () => {
        const option = button.dataset.option
        if (NEEDS_TEXT.test(option)) {
          const start = option.replace(/<[^>]*>/g, '').trim()
          textarea.value = /^outr[ao]s?$/i.test(start) ? textarea.value : `${start} `
          textarea.focus()
          return
        }
        selected = selected === option ? '' : option
        for (const other of buttons) other.setAttribute('aria-pressed', String(other.dataset.option === selected))
      })
    }
    return h('div', { class: 'm-options', role: 'group', 'aria-label': 'Opções de resposta' }, buttons)
  }

  function render(data) {
    card = data
    const q = data.question ?? { text: null, options: [], answered: null }
    const missing = (data.credenciais ?? []).filter((c) => c.status === 'ausente').map((c) => c.chave)
    const pending = data.coluna === 'pendente-diego'
    columnChip.hidden = false
    columnChip.textContent = COLUMN_LABELS[data.coluna] ?? data.coluna
    resolve.hidden = !pending
    respond.disabled = false
    const dataBody = h('div', {}, metaRows(data),
      h('div', { class: 'm-md', innerHTML: markdownSeguro(withoutSections(semSecaoDeCredenciais(data.corpo), ['Notas', 'Resposta do Diego'])) }),
      (data.credenciais ?? []).length ? h('div', { class: 'm-creds' }, h('h3', { class: 'm-h3' }, 'Credenciais necessárias'),
        h('ul', { class: 'm-cred-list' }, data.credenciais.map((c) => h('li', { dataset: { status: c.status } }, h('code', {}, c.chave), h('span', {}, c.status)))),
        h('section', { class: 'modal-cred-form', dataset: { slot: 'cred-form' }, hidden: true })) : null)
    const title = clampedText('h1', 'm-card-title', data.title ?? id, q.text ? 4 : 8)
    Object.assign(title.querySelector('h1'), { id: 'm-card-title', tabIndex: -1 })
    // `replaceChildren(null)` escreveria a palavra "null": os opcionais saem da lista antes.
    const sections = [
      title,
      h('div', { class: 'm-chips' }, priorityChip(data.prioridade, { withLabel: true }), data.risk ? h('span', { class: `m-chip m-risk`, dataset: { risk: data.risk } }, RISK_LABEL[data.risk] ?? `risco ${data.risk}`) : null, data.project && typeof data.project === 'string' ? h('span', { class: 'm-chip m-col-chip' }, data.project) : null),
      missing.length ? h('p', { class: 'm-alert', role: 'status' }, `Faltam credenciais de teste: ${missing.join(', ')}. Abra Dados para enviar.`) : null,
      q.text ? h('section', { class: 'm-question-box' }, h('h2', { class: 'm-h2' }, 'Pergunta'), h('p', { class: 'm-question-text' }, q.text)) : null,
      q.answered ? h('p', { class: 'm-answered', role: 'status' }, h('span', { class: 'm-check', 'aria-hidden': 'true' }, '✓'), h('span', { class: 'm-answered-text' }, `respondido${q.answered.option ? `: ${q.answered.option}` : ''}`), h('span', { class: 'm-when' }, formatWhen(q.answered.at))) : null,
      h('section', { class: 'm-answer-box' }, h('h2', { class: 'm-h2' }, pending ? 'Sua resposta' : 'Responder'), q.options.length ? optionButtons(q.options) : null, textarea, message),
      previousAnswers(data.corpo),
      fold('Dados', dataBody),
      fold('Atividades da IA', activityList(data.notes ?? [])),
    ]
    body.replaceChildren(...sections.filter(Boolean))
    measureClamps(body)
    const slot = body.querySelector('[data-slot="cred-form"]')
    if (slot) mountCredentialForm(id, slot, comProjeto)
    body.querySelector('.m-card-title').focus({ preventScroll: true })
  }

  async function load() {
    try {
      render(await getJson(`/api/cards/${encodeURIComponent(id)}`))
    } catch (error) {
      const notFound = error instanceof ApiError && error.status === 404
      body.replaceChildren(h('div', { class: 'm-empty' }, h('p', { class: 'm-empty-title' }, notFound ? `Não encontrei o card ${id}` : 'Não consegui carregar o card'),
        h('button', { type: 'button', class: 'm-retry', onclick: notFound ? back : load }, notFound ? 'Voltar' : 'Tentar de novo')))
    }
  }

  function setBusy(busy) {
    for (const control of [respond, resolve, textarea]) control.disabled = busy
    body.querySelectorAll('.m-opt').forEach((b) => { b.disabled = busy })
  }
  const answer = () => ({ option: selected, text: textarea.value.trim() })
  async function submit(kind) {
    const { option, text } = answer()
    if (kind === 'answer' && !option && !text) {
      message.textContent = 'Escolha uma opção ou escreva sua resposta.'
      message.hidden = false
      textarea.focus()
      return
    }
    message.hidden = true
    setBusy(true)
    try {
      if (kind === 'answer') await answerCard(id, { option, text })
      else await postJson(`/api/cards/${encodeURIComponent(id)}/resolve`, { option, text })
      toast(kind === 'answer' ? 'Resposta enviada' : 'Pendência resolvida')
      selected = ''
      textarea.value = ''
      refresh()
      if (kind === 'resolve') return back()
      await load()
    } catch (e) {
      message.textContent = e instanceof TypeError ? 'Sem conexão: não foi enviado.' : `Não enviou: ${e.message}`
      message.hidden = false
    } finally {
      setBusy(false)
    }
  }
  respond.addEventListener('click', () => submit('answer'))
  resolve.addEventListener('click', () => submit('resolve'))

  if (summary) {
    body.replaceChildren(h('h1', { id: 'm-card-title', class: 'm-card-title', tabindex: '-1' }, summary.title ?? id), h('div', { class: 'm-skeleton', 'aria-hidden': 'true' }, h('div', { class: 'm-skel-card' })))
  }
  layer.setAttribute('aria-labelledby', 'm-card-title')
  load()
  backButton.focus({ preventScroll: true })
  return { destroy: stopFit }
}
