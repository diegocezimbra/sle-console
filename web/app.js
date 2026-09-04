// Tela da Fase 1: so observa. Nada aqui escreve no daemon.
const CORES = { L1: '#4aa3df', L2: '#c08b3e', L3: '#7b5ec7' }
const eventos = []
const $ = (id) => document.getElementById(id)

try {
  const inicial = await (await fetch('/api/snapshot')).json()
  eventos.push(...inicial.fluxo)
  pintarSessoes(inicial.sessoes)
  pintarContadores(inicial.contadores)
  pintarFluxo()
  pintarRegua()
} catch (e) {
  // Primeiro paint quebrado nao pode impedir o fluxo ao vivo de conectar.
  console.error('sle: falha ao montar o estado inicial', e)
}

const stream = new EventSource('/api/stream')
stream.onopen = () => $('conexao').replaceChildren('ao vivo') || $('conexao').classList.add('vivo')
stream.onerror = () => {
  $('conexao').classList.remove('vivo')
  $('conexao').textContent = 'reconectando…'
}
stream.onmessage = async (m) => {
  eventos.push(JSON.parse(m.data))
  if (eventos.length > 300) eventos.shift()
  pintarFluxo()
  pintarRegua()
  const s = await (await fetch('/api/snapshot')).json()
  pintarSessoes(s.sessoes)
  pintarContadores(s.contadores)
}

function pintarContadores(c) {
  $('contadores').textContent = `${c.eventos} eventos · ${c.falhas} falhas`
}

function pintarSessoes(sessoes) {
  const ul = $('sessoes')
  if (!sessoes.length) return
  ul.replaceChildren(
    ...sessoes.map((s) => {
      const li = document.createElement('li')
      if (!s.ativa) li.className = 'morta'
      const id = document.createElement('div')
      id.className = 'id'
      id.textContent = s.agente ?? s.id.slice(0, 12)
      const meta = document.createElement('div')
      meta.className = 'meta'
      meta.textContent = `${s.eventos} eventos · ${s.ativa ? 'ativa' : 'encerrada'}`
      li.append(id, meta)
      return li
    })
  )
}

function pintarFluxo() {
  const ol = $('fluxo')
  ol.replaceChildren(
    ...eventos.slice(-120).map((e) => {
      const li = document.createElement('li')
      if (e.payload?.ok === false) li.className = 'falha'
      li.append(
        campo('hora', e.ts.slice(11, 19)),
        campo('kind', e.kind),
        campo('alvo', e.payload?.file ?? e.payload?.command ?? e.payload?.cwd ?? ''),
        campo('ms', e.payload?.ms != null ? `${e.payload.ms}ms` : '')
      )
      return li
    })
  )
  ol.parentElement.scrollTop = ol.parentElement.scrollHeight
}

function campo(classe, texto) {
  const s = document.createElement('span')
  s.className = classe
  s.textContent = texto
  return s
}

// A regua e um analisador logico: uma faixa por escala de tempo, um traco por
// evento. Canvas a mao porque biblioteca de grafico nao desenha isto.
function pintarRegua() {
  const c = $('regua')
  const ctx = c.getContext('2d')
  const l = (c.width = c.clientWidth * devicePixelRatio)
  const a = (c.height = 120 * devicePixelRatio)
  ctx.clearRect(0, 0, l, a)
  if (!eventos.length) return

  const faixas = ['L1', 'L2', 'L3']
  const t0 = Date.parse(eventos[0].ts)
  const t1 = Math.max(Date.parse(eventos.at(-1).ts), t0 + 1000)
  const x = (ts) => ((Date.parse(ts) - t0) / (t1 - t0)) * (l - 8) + 4

  faixas.forEach((faixa, i) => {
    const y = (i + 0.5) * (a / faixas.length)
    ctx.strokeStyle = '#252a34'
    ctx.lineWidth = 1 * devicePixelRatio
    ctx.beginPath()
    ctx.moveTo(0, y)
    ctx.lineTo(l, y)
    ctx.stroke()

    ctx.strokeStyle = CORES[faixa]
    ctx.lineWidth = 2 * devicePixelRatio
    for (const e of eventos) {
      if (e.loop !== faixa) continue
      const px = x(e.ts)
      ctx.beginPath()
      ctx.moveTo(px, y - 9 * devicePixelRatio)
      ctx.lineTo(px, y + 9 * devicePixelRatio)
      ctx.stroke()
    }
  })
}
addEventListener('resize', pintarRegua)
