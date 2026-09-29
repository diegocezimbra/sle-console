import { renderMarkdown } from './chat-md.js'
import { insertIndex, sinceWithLookback, splitLate } from './chat-order.js'
import { attachmentsOf, mountAttachments, textWithoutCitations } from './chat-anexos.js'

const $ = (id) => document.getElementById(id)
const thread = $('thread')
const aviso = (texto) => {
  const p = document.createElement('p')
  p.className = 'aviso'
  p.textContent = texto
  thread.replaceChildren(p)
}
const AUTOR = { diego: 'Diego', deus: 'DEUS' }
// Mensagem espelhada da conversa da sessao DEUS (VS Code), nao digitada aqui nem enviada por `deus chat enviar`.
const ORIGEM = { sessao: 'VS Code' }
// `?poll=<ms>` (250 a 60000) so existe para o teste de interface nao esperar 8 s.
const POLL_MS = Math.min(Math.max(Number(new URLSearchParams(location.search).get('poll')) || 8000, 250), 60_000)
let ultimoTs = ''
let proximo = null
let carregandoAntigas = false
let modoBusca = false
const vistos = new Set()

const fmtDia = (ts) => new Date(ts).toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' })
const fmtHora = (ts) => new Date(ts).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
const chaveDia = (ts) => new Date(ts).toLocaleDateString('sv-SE')

function cabecalhoDia(ts) {
  const d = document.createElement('div')
  d.className = 'dia'
  d.dataset.dia = chaveDia(ts)
  d.textContent = fmtDia(ts)
  return d
}

function balao(m, destaque = false) {
  const el = document.createElement('article')
  el.className = `msg ${m.de}${destaque ? ' achada' : ''}`
  el.dataset.id = m.id
  el.dataset.ts = m.ts
  // Cabecalho por DOM/textContent (dado do jsonl nunca vira HTML); so o corpo passa por
  // renderMarkdown, que escapa tudo antes de reintroduzir marcas.
  const meta = document.createElement('div')
  meta.className = 'meta'
  const autor = document.createElement('span')
  autor.textContent = AUTOR[m.de] ?? '?'
  const hora = document.createElement('time')
  hora.dateTime = String(m.ts)
  hora.textContent = fmtHora(m.ts)
  meta.append(autor, hora)
  if (ORIGEM[m.origem]) {
    const via = document.createElement('span')
    via.className = 'via'
    via.textContent = `via ${ORIGEM[m.origem]}`
    meta.append(via)
  }
  const corpo = document.createElement('div')
  corpo.className = 'corpo'
  corpo.innerHTML = renderMarkdown(textWithoutCitations(m))
  el.append(meta, corpo)
  const anexos = attachmentsOf(m) // CARD-094: miniaturas das imagens da mensagem
  if (anexos) el.append(anexos)
  return el
}

function baloes(msgs, { destaque = false, dia = null } = {}) {
  const frag = document.createDocumentFragment()
  for (const m of msgs) {
    if (chaveDia(m.ts) !== dia) {
      dia = chaveDia(m.ts)
      frag.append(cabecalhoDia(m.ts))
    }
    frag.append(balao(m, destaque))
  }
  return frag
}

/** Retardatario (o espelho publicou depois): entra no lugar do ts, nao no fim. */
function inserirNoLugar(m) {
  const todas = [...thread.querySelectorAll('.msg')]
  const i = insertIndex(todas.map((el) => el.dataset.ts), m.ts)
  const el = balao(m)
  if (i < todas.length) todas[i].before(el)
  else thread.append(el)
}

/** Cabecalhos de dia sempre batem com as mensagens depois de uma insercao no meio. */
function refazerDias() {
  thread.querySelectorAll('.dia').forEach((d) => d.remove())
  let dia = null
  for (const el of thread.querySelectorAll('.msg')) {
    if (chaveDia(el.dataset.ts) === dia) continue
    dia = chaveDia(el.dataset.ts)
    el.before(cabecalhoDia(el.dataset.ts))
  }
}

async function api(caminho, opcoes) {
  const r = await fetch(caminho, opcoes)
  const corpo = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(corpo.erro || `erro ${r.status}`)
  return corpo
}

const diaAtual = () => thread.querySelector('.msg:last-of-type') ? chaveDia(thread.querySelector('.msg:last-of-type').dataset.ts) : null
const noFim = () => thread.scrollHeight - thread.scrollTop - thread.clientHeight < 80
const rolarFim = () => { thread.scrollTop = thread.scrollHeight }

async function carregarInicial() {
  const { mensagens, proximo: p } = await api('/api/chat?dias=2')
  $('carregando')?.remove()
  proximo = p
  thread.replaceChildren()
  if (!mensagens.length) aviso('nenhuma mensagem ainda')
  else thread.append(baloes(mensagens))
  mensagens.forEach((m) => vistos.add(m.id))
  ultimoTs = mensagens.at(-1)?.ts ?? ''
  rolarFim()
  document.body.dataset.pronto = 'sim'
}

async function carregarAntigas() {
  if (!proximo || carregandoAntigas || modoBusca) return
  carregandoAntigas = true
  try {
    const { mensagens, proximo: p } = await api(`/api/chat?antes=${proximo}&dias=2`)
    proximo = p
    const altura = thread.scrollHeight
    thread.prepend(baloes(mensagens))
    mensagens.forEach((m) => vistos.add(m.id))
    thread.scrollTop += thread.scrollHeight - altura
  } finally {
    carregandoAntigas = false
  }
}

async function buscarNovas() {
  if (modoBusca || !ultimoTs) return
  try {
    // Recuo de alguns minutos: o espelho publica retardatario com o ts de quando a frase foi dita.
    const { mensagens } = await api(`/api/chat?desde=${encodeURIComponent(sinceWithLookback(ultimoTs))}`)
    const novas = mensagens.filter((m) => !vistos.has(m.id))
    if (!novas.length) return
    const seguir = noFim()
    thread.querySelector('.aviso')?.remove()
    const { tail, late } = splitLate(novas, ultimoTs)
    late.forEach(inserirNoLugar)
    if (late.length) refazerDias()
    if (tail.length) {
      thread.append(baloes(tail, { dia: diaAtual() }))
      ultimoTs = tail.at(-1).ts
    }
    novas.forEach((m) => vistos.add(m.id))
    if (seguir) rolarFim()
  } catch { /* proxima rodada tenta de novo */ }
}

async function enviar(texto) {
  const erro = $('erro')
  erro.hidden = true
  erro.textContent = ''
  const botao = $('envio').querySelector('button[type=submit]')
  botao.disabled = true
  try {
    // CARD-094: com foto anexada vai pela rota de imagens (texto + ate 4 fotos); sem foto, a de sempre.
    const anexos = files.count() ? await files.take() : null
    const { mensagem, aviso: alerta } = anexos
      ? await api('/api/chat/attachments', { method: 'POST', body: JSON.stringify({ texto, anexos }) })
      : await api('/api/chat', { method: 'POST', body: JSON.stringify({ texto }) })
    files.clear()
    if (alerta === 'secret') {
      erro.textContent = 'Parece conter segredo; o DEUS não vai repetir. A mensagem foi enviada, considere rotacionar a credencial.'
      erro.hidden = false
    }
    $('texto').value = ''
    autoAltura()
    if (!vistos.has(mensagem.id)) {
      thread.querySelector('.aviso')?.remove()
      thread.append(baloes([mensagem], { dia: diaAtual() }))
      vistos.add(mensagem.id)
      ultimoTs = mensagem.ts
    }
    rolarFim()
  } catch (e) {
    erro.textContent = e.message
    erro.hidden = false
  } finally {
    botao.disabled = false
  }
}

function autoAltura() {
  const t = $('texto')
  t.style.height = 'auto'
  t.style.height = `${Math.min(t.scrollHeight, window.innerHeight * 0.4)}px`
}

let timerBusca
$('busca').addEventListener('input', (e) => {
  clearTimeout(timerBusca)
  const termo = e.target.value.trim()
  timerBusca = setTimeout(async () => {
    if (!termo) {
      modoBusca = false
      vistos.clear()
      return carregarInicial()
    }
    modoBusca = true
    const { mensagens } = await api(`/api/chat?q=${encodeURIComponent(termo)}`)
    thread.replaceChildren()
    if (!mensagens.length) aviso('nada encontrado')
    else thread.append(baloes(mensagens.slice().reverse(), { destaque: true }))
    thread.scrollTop = 0
  }, 250)
})

$('texto').addEventListener('input', autoAltura)
$('texto').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    e.preventDefault()
    $('envio').requestSubmit()
  }
})
$('envio').addEventListener('submit', (e) => {
  e.preventDefault()
  const texto = $('texto').value.trim()
  if (texto || files.count()) enviar(texto)
})
thread.addEventListener('scroll', () => { if (thread.scrollTop < 120) carregarAntigas() })

const files = mountAttachments({
  button: $('anexar'), menu: $('anexar-menu'), preview: $('previa'),
  notify: (texto) => { $('erro').textContent = texto; $('erro').hidden = false },
})

carregarInicial().catch((e) => { aviso(`falha ao carregar: ${e.message}`) })
setInterval(buscarNovas, POLL_MS)
