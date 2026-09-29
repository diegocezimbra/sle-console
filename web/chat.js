import { renderMarkdown } from './chat-md.js'

const $ = (id) => document.getElementById(id)
const thread = $('thread')
const AUTOR = { diego: 'Diego', deus: 'DEUS' }
const POLL_MS = 8000
let ultimoTs = ''
let proximo = null
let carregandoAntigas = false
let modoBusca = false
const vistos = new Set()

const fmtDia = (ts) => new Date(ts).toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' })
const fmtHora = (ts) => new Date(ts).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
const chaveDia = (ts) => new Date(ts).toLocaleDateString('sv-SE')

function baloes(msgs, { destaque = false, dia = null } = {}) {
  const frag = document.createDocumentFragment()
  for (const m of msgs) {
    if (chaveDia(m.ts) !== dia) {
      dia = chaveDia(m.ts)
      const d = document.createElement('div')
      d.className = 'dia'
      d.dataset.dia = dia
      d.textContent = fmtDia(m.ts)
      frag.append(d)
    }
    const el = document.createElement('article')
    el.className = `msg ${m.de}${destaque ? ' achada' : ''}`
    el.dataset.id = m.id
    el.dataset.ts = m.ts
    el.innerHTML = `<div class="meta"><span>${AUTOR[m.de]}</span><time datetime="${m.ts}">${fmtHora(m.ts)}</time></div>${renderMarkdown(m.texto)}`
    frag.append(el)
  }
  return frag
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
  if (!mensagens.length) thread.innerHTML = '<p class="aviso">nenhuma mensagem ainda</p>'
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
    const { mensagens } = await api(`/api/chat?desde=${encodeURIComponent(ultimoTs)}`)
    const novas = mensagens.filter((m) => !vistos.has(m.id))
    if (!novas.length) return
    const seguir = noFim()
    thread.querySelector('.aviso')?.remove()
    thread.append(baloes(novas, { dia: diaAtual() }))
    novas.forEach((m) => vistos.add(m.id))
    ultimoTs = novas.at(-1).ts
    if (seguir) rolarFim()
  } catch { /* proxima rodada tenta de novo */ }
}

async function enviar(texto) {
  const erro = $('erro')
  erro.hidden = true
  try {
    const { mensagem } = await api('/api/chat', { method: 'POST', body: JSON.stringify({ texto }) })
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
    if (!mensagens.length) thread.innerHTML = '<p class="aviso">nada encontrado</p>'
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
  if (texto) enviar(texto)
})
thread.addEventListener('scroll', () => { if (thread.scrollTop < 120) carregarAntigas() })

carregarInicial().catch((e) => { thread.innerHTML = `<p class="aviso">falha ao carregar: ${e.message}</p>` })
setInterval(buscarNovas, POLL_MS)
