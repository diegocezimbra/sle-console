// Tela da Fase 2: observar e ler. Nada aqui escreve no daemon.
const CORES = { L1: '#4aa3df', L2: '#c08b3e', L3: '#7b5ec7' }
const COLUNAS = ['backlog', 'refinamento', 'aprovado', 'doing', 'review', 'done', 'recurring']
const eventos = []
let indice = { board: {}, cards: [] }

const $ = (id) => document.getElementById(id)

function mostrar(tela) {
  for (const s of document.querySelectorAll('main > section')) s.hidden = s.id !== `tela-${tela}`
  for (const b of document.querySelectorAll('nav button')) b.classList.toggle('ativa', b.dataset.tela === tela)
  if (tela === 'fluxo') pintarRegua()
  if (tela === 'editar') pintarArquivos()
  if (tela === 'controle') pintarControle()
}
for (const b of document.querySelectorAll('nav button')) {
  b.addEventListener('click', () => mostrar(b.dataset.tela))
}

try {
  const s = await (await fetch('/api/snapshot')).json()
  eventos.push(...s.fluxo)
  indice = { board: s.board ?? {}, cards: s.cards ?? [] }
  pintarSessoes(s.sessoes)
  pintarContadores(s.contadores)
  pintarGit(s.git)
  pintarFluxo()
  pintarRegua()
  pintarBoard()
} catch (e) {
  console.error('sle: falha ao montar o estado inicial', e)
} finally {
  // Sinal explicito de que o JS montou: o HTML sozinho ja tem os botoes, entao
  // esperar por eles nao prova que os listeners existem.
  document.body.dataset.pronto = 'sim'
}

const stream = new EventSource('/api/stream')
stream.onopen = () => {
  $('conexao').textContent = 'ao vivo'
  $('conexao').classList.add('vivo')
}
stream.onerror = () => {
  $('conexao').classList.remove('vivo')
  $('conexao').textContent = 'reconectando…'
}
stream.onmessage = async (m) => {
  const e = JSON.parse(m.data)
  // Mudanca no disco recarrega o indice; evento de agente entra no fluxo.
  if (e.kind === 'arquivo.mudou') return recarregarIndice()

  eventos.push(e)
  if (eventos.length > 300) eventos.shift()
  pintarFluxo()
  pintarRegua()
  const s = await (await fetch('/api/snapshot')).json()
  pintarSessoes(s.sessoes)
  pintarContadores(s.contadores)
  pintarGit(s.git)
}

async function recarregarIndice() {
  indice = await (await fetch('/api/cards')).json()
  pintarBoard()
  pintarGit(await (await fetch('/api/git/tree')).json())
}

function pintarContadores(c) {
  if (c) $('contadores').textContent = `${c.eventos} eventos · ${c.falhas} falhas`
}

function pintarGit(g) {
  if (!g?.branch) return ($('git').textContent = 'sem git')
  const sujo = g.sujo ? ` · ${g.alteracoes.length} alterado(s)` : ' · limpo'
  $('git').textContent = `${g.branch} ${g.head}${sujo}`
}

function pintarSessoes(sessoes) {
  if (!sessoes?.length) return
  $('sessoes').replaceChildren(
    ...sessoes.map((s) => {
      const li = document.createElement('li')
      if (!s.ativa) li.className = 'morta'
      li.append(
        campo('id', s.agente ?? s.id.slice(0, 12)),
        campo('meta', `${s.eventos} eventos · ${s.ativa ? 'ativa' : 'encerrada'}`)
      )
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
        campo('alvo', e.payload?.file ?? e.payload?.command ?? e.payload?.caminho ?? e.payload?.cwd ?? ''),
        campo('ms', e.payload?.ms != null ? `${e.payload.ms}ms` : '')
      )
      return li
    })
  )
  ol.parentElement.scrollTop = ol.parentElement.scrollHeight
}

function pintarBoard() {
  $('colunas').replaceChildren(
    ...COLUNAS.map((coluna) => {
      const cards = indice.board?.[coluna] ?? []
      const div = document.createElement('div')
      div.className = 'coluna'
      div.dataset.coluna = coluna

      const h = document.createElement('h3')
      h.append(campo('nome', coluna), campo('qtd', String(cards.length)))
      const lista = document.createElement('div')
      lista.append(...cards.map(botaoDeCard))
      div.append(h, lista)
      return div
    })
  )
}

function botaoDeCard(c) {
  const b = document.createElement('button')
  b.className = `card risco-${c.risk ?? 'baixo'}`
  b.dataset.card = c.id
  b.append(campo('cid', c.id), campo('titulo', c.title ?? ''))
  b.addEventListener('click', () => abrirCard(c.id))
  return b
}

function abrirCard(id) {
  const c = indice.cards.find((x) => x.id === id)
  if (!c) return
  const titulo = document.createElement('h3')
  titulo.textContent = `${c.id} — ${c.title ?? ''}`
  const meta = document.createElement('div')
  meta.className = 'meta'
  meta.append(
    campo('m', `coluna ${c.coluna}`),
    campo('m', `risco ${c.risk ?? '—'}`),
    campo('m', `orçamento ${c.budget_usd ?? '—'} USD / ${c.budget_turns ?? '—'} turnos`)
  )
  const corpo = document.createElement('pre')
  corpo.textContent = c.corpo ?? ''
  $('card-conteudo').replaceChildren(titulo, meta, corpo)
  document.querySelector('nav button[data-tela="card"]').hidden = false
  mostrar('card')
}

// ── Edição ────────────────────────────────────────────────────────────────
let arquivoAberto = null

async function pintarArquivos() {
  const { cards } = await (await fetch('/api/cards')).json()
  const editaveis = [
    ...(await listar('sle/gates')),
    ...(await listar('sle/prompts')),
    ...(await listar('sle/agents')),
    ...cards.map((c) => caminhoRelativo(c.arquivo)),
  ]
  $('arquivos').replaceChildren(
    ...editaveis.map((caminho) => {
      const li = document.createElement('li')
      const b = document.createElement('button')
      b.textContent = caminho
      b.dataset.caminho = caminho
      b.addEventListener('click', () => abrirArquivo(caminho))
      li.append(b)
      return li
    })
  )
}

const caminhoRelativo = (abs) => (abs ?? '').split(/cards[/\\]/).slice(1).join('cards/') ? 'cards/' + abs.split(/cards[/\\]/)[1] : abs

async function listar(pasta) {
  const r = await fetch(`/api/dir?path=${encodeURIComponent(pasta)}`)
  const j = await r.json()
  return j.arquivos ?? []
}

async function abrirArquivo(caminho) {
  const j = await (await fetch(`/api/file?path=${encodeURIComponent(caminho)}`)).json()
  if (j.erro) return avisar(j.erro, true)
  arquivoAberto = caminho
  $('editor').value = j.conteudo
  $('abertoem').textContent = caminho
  avisar('')
  for (const b of document.querySelectorAll('#arquivos button')) {
    b.classList.toggle('aberto', b.dataset.caminho === caminho)
  }
}

$('salvar').addEventListener('click', async () => {
  if (!arquivoAberto) return avisar('nenhum arquivo aberto', true)
  const r = await fetch(`/api/file?path=${encodeURIComponent(arquivoAberto)}`, {
    method: 'PUT',
    body: $('editor').value,
  })
  const j = await r.json()
  // Erro de validacao nao pode ser silencioso nem parecer sucesso.
  avisar(r.ok ? 'salvo' : j.erro, !r.ok)
})

$('testar').addEventListener('click', async () => {
  $('saida').textContent = 'rodando…'
  const j = await (
    await fetch('/api/gates/test', { method: 'POST', body: JSON.stringify({ comando: $('comando').value }) })
  ).json()
  $('saida').textContent = `exit ${j.exit} · ${j.ms}ms\n\n${j.saida}`
})

function avisar(texto, erro = false) {
  $('aviso').textContent = texto
  $('aviso').classList.toggle('erro', erro)
}

// ── Controle ──────────────────────────────────────────────────────────────
async function pintarControle() {
  const { agentes, ativos, gasto } = await (await fetch('/api/agents')).json()
  $('gasto').textContent = `${(gasto ?? 0).toFixed(2)} USD hoje`

  // Regra de ouro: o revisor adversarial nunca deve rodar no mesmo modelo do
  // implementador -- o mesmo modelo tende a aprovar o proprio tipo de erro.
  const modelosDeMaker = new Set(agentes.filter((a) => a.role === 'maker').map((a) => a.model))
  const conflita = (a) =>
    (a.role === 'checker' && modelosDeMaker.has(a.model)) ||
    (a.role === 'maker' && agentes.some((o) => o.role === 'checker' && o.model === a.model))

  $('agentes').replaceChildren(
    ...agentes.map((a) => {
      const div = document.createElement('div')
      div.className = `agente${conflita(a) ? ' alerta' : ''}`
      if (conflita(a)) div.title = 'maker e checker no mesmo modelo: erros correlacionados'
      div.append(
        campo('nome', a.id),
        campo('det', `${a.role ?? '—'} · ${a.model ?? 'sem modelo'}`),
        campo('det', a.provider ?? '')
      )
      const b = document.createElement('button')
      b.textContent = 'Rodar'
      b.dataset.rodar = a.id
      b.addEventListener('click', async () => {
        await fetch(`/api/agents/${encodeURIComponent(a.id)}/run`, { method: 'POST' })
        pintarControle()
      })
      div.append(b)
      return div
    })
  )

  $('ativos').replaceChildren(
    ...(ativos.length
      ? ativos.map((p) => {
          const li = document.createElement('li')
          li.className = 'processo'
          li.textContent = `${p.agente} · pid ${p.pid} · desde ${p.inicio.slice(11, 19)}`
          return li
        })
      : [campoLi('nenhum agente rodando')])
  )
}

function campoLi(texto) {
  const li = document.createElement('li')
  li.className = 'vazio'
  li.textContent = texto
  return li
}

$('parada').addEventListener('click', async () => {
  await fetch('/api/emergency-stop', { method: 'POST' })
  pintarControle()
})

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
  if (!c.clientWidth) return
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
