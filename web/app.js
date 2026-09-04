// Tela da Fase 2: observar e ler. Nada aqui escreve no daemon.
const CORES = { L1: '#4aa3df', L2: '#c08b3e', L3: '#7b5ec7' }
const COLUNAS = ['backlog', 'refinamento', 'aprovado', 'doing', 'review', 'done', 'recurring']
const eventos = []
let indice = { board: {}, cards: [] }
// Projeto observado. Vai em toda chamada de leitura, para a tela nunca mostrar
// o board de um projeto com o git de outro.
let projetoAtual = null
const comProjeto = (rota) =>
  projetoAtual ? `${rota}${rota.includes('?') ? '&' : '?'}projeto=${encodeURIComponent(projetoAtual)}` : rota

const $ = (id) => document.getElementById(id)

function mostrar(tela) {
  for (const s of document.querySelectorAll('main > section')) s.hidden = s.id !== `tela-${tela}`
  for (const b of document.querySelectorAll('nav button')) b.classList.toggle('ativa', b.dataset.tela === tela)
  if (tela === 'fluxo') pintarRegua()
  // Cada tela relê o disco ao ser aberta: o arquivo pode ter mudado no editor.
  if (tela === 'board') recarregarIndice()
  if (tela === 'editar') pintarArquivos()
  if (tela === 'controle') pintarControle()
  if (tela === 'metricas') pintarMetricas()
  if (tela === 'historico') pintarHistorico()
}
for (const b of document.querySelectorAll('nav button')) {
  b.addEventListener('click', () => mostrar(b.dataset.tela))
}

try {
  await montarSeletorDeProjetos()
  const s = await (await fetch(comProjeto('/api/snapshot'))).json()
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
  const s = await (await fetch(comProjeto('/api/snapshot'))).json()
  pintarSessoes(s.sessoes)
  pintarContadores(s.contadores)
  pintarGit(s.git)
}

async function recarregarIndice() {
  indice = await (await fetch(comProjeto('/api/cards'))).json()
  pintarBoard()
  pintarGit(await (await fetch(comProjeto('/api/git/tree'))).json())
}

async function montarSeletorDeProjetos() {
  const { projetos, atual, todos } = await (await fetch('/api/projetos')).json()
  const sel = $('projeto')
  if (!projetos?.length) return
  // Com dezenas de repositórios, "um por vez" esconde onde está o trabalho.
  projetoAtual = todos ?? atual
  const opcaoTodos = document.createElement('option')
  opcaoTodos.value = todos
  opcaoTodos.textContent = `todos os projetos (${projetos.length})`
  opcaoTodos.selected = true
  sel.replaceChildren(
    opcaoTodos,
    ...projetos.map((p) => {
      const o = document.createElement('option')
      o.value = p.caminho
      o.textContent = p.rotulo
      o.selected = false
      return o
    })
  )
  sel.addEventListener('change', async () => {
    projetoAtual = sel.value
    await recarregarIndice()
    if (!$('tela-editar').hidden) pintarArquivos()
    if (!$('tela-controle').hidden) pintarControle()
  })
}

function pintarContadores(c) {
  if (c) $('contadores').textContent = `${c.eventos} eventos · ${c.falhas} falhas`
}

function pintarGit(g) {
  // Não existe "a branch" de 75 repositórios: existe quantos estão sujos.
  if (g?.repos != null) {
    $('git').textContent = `${g.repos} repos · ${g.sujos} com alteração`
    $('git').title = (g.detalhe ?? [])
      .map((d) => `${d.projeto}: ${d.alteracoes} alterado(s)`)
      .join('\n')
    return
  }
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
        campo('id', s.agente ?? s.projeto ?? s.id.slice(0, 8)),
        campo('meta', `${s.eventos} eventos · ${s.ativa ? `há ${idade(s.inativoMs)}` : 'inativa'}`)
      )
      return li
    })
  )
}

/** "3s", "4min", "2h" -- tempo desde o ultimo sinal. */
function idade(ms) {
  const s = Math.round((ms ?? 0) / 1000)
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.round(s / 60)}min`
  return `${Math.round(s / 3600)}h`
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
  // Na visão de todos, o card diz de que projeto veio.
  b.append(campo('cid', c.rotuloProjeto ? `${c.rotuloProjeto} · ${c.id}` : c.id),
           campo('titulo', c.title ?? ''))
  b.addEventListener('click', () => abrirCard(c.id))

  // Mover é uma ação do board: ir buscar o arquivo no editor para trocar uma
  // linha de frontmatter seria trabalho manual num lugar que já sabe a ordem.
  const mover = document.createElement('span')
  mover.className = 'mover'
  for (const [rotulo, dir] of [['←', -1], ['→', 1]]) {
    const m = document.createElement('button')
    m.textContent = rotulo
    m.dataset.mover = c.id
    m.dataset.dir = String(dir)
    m.title = dir < 0 ? 'voltar uma coluna' : 'avançar uma coluna'
    m.addEventListener('click', async (ev) => {
      ev.stopPropagation()
      const destino = COLUNAS[COLUNAS.indexOf(c.coluna) + dir]
      if (!destino) return
      await fetch(`/api/cards/${encodeURIComponent(c.id)}/move`, {
        method: 'POST',
        body: JSON.stringify({ para: destino }),
      })
      await recarregarIndice()
    })
    mover.append(m)
  }
  b.append(mover)
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

const ehTodos = () => projetoAtual === '*'

async function pintarArquivos() {
  if (ehTodos()) {
    $('arquivos').replaceChildren(campoLi('escolha um projeto no seletor para editar'))
    $('editor').value = ''
    return
  }
  const { cards } = await (await fetch(comProjeto('/api/cards'))).json()
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
  const r = await fetch(comProjeto(`/api/dir?path=${encodeURIComponent(pasta)}`))
  const j = await r.json()
  return j.arquivos ?? []
}

async function abrirArquivo(caminho) {
  const j = await (await fetch(comProjeto(`/api/file?path=${encodeURIComponent(caminho)}`))).json()
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
  const r = await fetch(comProjeto(`/api/file?path=${encodeURIComponent(arquivoAberto)}`), {
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
  if (ehTodos()) {
    $('agentes').replaceChildren(campoLi('escolha um projeto no seletor para ver os agentes dele'))
    $('ativos').replaceChildren(campoLi('—'))
    return
  }
  const { agentes, ativos, sessoes, gasto } = await (await fetch(comProjeto('/api/agents'))).json()
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

  // Duas origens, uma lista: o que o console lançou e o que ele observa.
  const linhas = [
    ...ativos.map((p) => item('lancado', `${p.agente} · pid ${p.pid} · desde ${p.inicio.slice(11, 19)}`)),
    ...(sessoes ?? []).map((s) =>
      item('observado', `${s.projeto ?? s.id.slice(0, 8)} · ${s.eventos} eventos · há ${idade(s.inativoMs)}`)
    ),
  ]
  $('ativos').replaceChildren(
    ...(linhas.length ? linhas : [campoLi('nenhum agente rodando nem sessão observada')])
  )
}

function item(origem, texto) {
  const li = document.createElement('li')
  li.className = `processo ${origem}`
  li.append(campo('origem', origem === 'lancado' ? 'lançado' : 'observado'), campo('txt', texto))
  return li
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

// ── Métricas e grafo ──────────────────────────────────────────────────────
const NOMES = {
  turnosPorCard: 'turnos por card',
  reprovacoesPorGate: 'reprovações por gate',
  gatesQueNuncaReprovam: 'gates que nunca reprovam',
  taxaDeEscalonamento: 'taxa de escalonamento',
  tempoDeReviewHumano: 'tempo de review humano',
  custoPorCard: 'custo por card',
  coberturaDeMutacao: 'cobertura de mutação',
  changeFailureRate: 'change failure rate',
}

async function pintarMetricas() {
  const m = await (await fetch('/api/metrics')).json()
  $('metricas').replaceChildren(
    ...Object.entries(m).map(([chave, { valor, estado }]) => {
      const div = document.createElement('div')
      // Sem dado é estado, não zero: zero seria uma afirmação que não temos.
      const semDado = valor === null
      const alerta = chave === 'gatesQueNuncaReprovam' && Array.isArray(valor) && valor.length > 0
      div.className = `metrica${semDado ? ' sem-dado' : ''}${alerta ? ' alerta' : ''}`
      if (alerta) div.title = 'verificação que nunca reprova está quebrada ou é decoração'
      div.append(campo('nome', NOMES[chave] ?? chave), campo('valor', semDado ? estado : formatar(chave, valor)))
      return div
    })
  )
  desenharGrafo()
}

function formatar(chave, valor) {
  if (chave === 'taxaDeEscalonamento') return `${(valor * 100).toFixed(0)}%`
  if (chave === 'tempoDeReviewHumano') return `${Math.round(valor / 60000)} min`
  if (Array.isArray(valor)) return valor.length ? valor.join(', ') : 'nenhum'
  if (valor && typeof valor === 'object') {
    return Object.entries(valor)
      .map(([k, v]) => `${k}: ${legivel(v)}`)
      .join('\n')
  }
  return String(valor)
}

/** `{reprovou: 2, passou: 1}` vira `2 reprovou · 1 passou`. */
function legivel(v) {
  if (v && typeof v === 'object') {
    return Object.entries(v)
      .map(([k, n]) => `${n} ${k.replace('_', ' ')}`)
      .join(' · ')
  }
  return typeof v === 'number' && !Number.isInteger(v) ? v.toFixed(2) : String(v)
}

/** Grafo de iteração: quantas voltas o par maker/checker deu, e onde. */
async function desenharGrafo() {
  const s = await (await fetch('/api/snapshot')).json()
  const c = $('grafo')
  if (!c.clientWidth) return
  const ctx = c.getContext('2d')
  const l = (c.width = c.clientWidth * devicePixelRatio)
  const a = (c.height = 200 * devicePixelRatio)
  ctx.clearRect(0, 0, l, a)

  const arestas = s.grafo ?? []
  if (!arestas.length) {
    ctx.fillStyle = '#8b93a1'
    ctx.font = `${12 * devicePixelRatio}px ui-monospace, monospace`
    ctx.fillText('nenhum subagente ainda', 12 * devicePixelRatio, 24 * devicePixelRatio)
    return
  }

  // O grafo e sobre papeis, nao sobre ids: "implementer -> adversarial-reviewer"
  // diz o que aconteceu; "s-b -> s-c" nao diz nada.
  const nomeDe = new Map((s.sessoes ?? []).map((x) => [x.id, x.agente ?? x.id.slice(0, 8)]))
  for (const e of arestas) if (e.agente) nomeDe.set(e.para, e.agente)
  // O harness nem sempre diz o nome do subagente: melhor dizer isso do que
  // pintar um nó com um uuid sem explicação.
  for (const e of arestas) if (e.anonimo) nomeDe.set(e.para, 'subagente')
  const rotulo = (id) => nomeDe.get(id) ?? String(id).slice(0, 8)

  const nos = [...new Set(arestas.flatMap((e) => [e.de, e.para]))]
  const pos = new Map(nos.map((n, i) => [n, {
    x: (l / (nos.length + 1)) * (i + 1),
    y: a / 2 + (i % 2 ? 34 : -34) * devicePixelRatio,
  }]))

  ctx.strokeStyle = '#4aa3df'
  ctx.lineWidth = 1.5 * devicePixelRatio
  for (const e of arestas) {
    const de = pos.get(e.de)
    const para = pos.get(e.para)
    ctx.beginPath()
    ctx.moveTo(de.x, de.y)
    ctx.lineTo(para.x, para.y)
    ctx.stroke()
  }

  ctx.font = `${11 * devicePixelRatio}px ui-monospace, monospace`
  ctx.textAlign = 'center'
  for (const [nome, p] of pos) {
    ctx.fillStyle = '#171a21'
    ctx.strokeStyle = '#252a34'
    const texto = rotulo(nome)
    const largura = ctx.measureText(texto).width + 16 * devicePixelRatio
    ctx.fillRect(p.x - largura / 2, p.y - 11 * devicePixelRatio, largura, 22 * devicePixelRatio)
    ctx.strokeRect(p.x - largura / 2, p.y - 11 * devicePixelRatio, largura, 22 * devicePixelRatio)
    ctx.fillStyle = '#d7dae0'
    ctx.fillText(texto, p.x, p.y + 4 * devicePixelRatio)
  }
  ctx.textAlign = 'left'
}

// ── Histórico ─────────────────────────────────────────────────────────────
$('hoje').addEventListener('click', () => {
  const hoje = new Date().toISOString().slice(0, 10)
  $('de').value = hoje
  $('ate').value = hoje
  pintarHistorico()
})
for (const id of ['de', 'ate']) $(id).addEventListener('change', pintarHistorico)

async function pintarHistorico() {
  const q = new URLSearchParams()
  if ($('de').value) q.set('de', $('de').value)
  if ($('ate').value) q.set('ate', $('ate').value)
  const dias = await (await fetch(`/api/historico?${q}`)).json()

  if (!dias.length) {
    $('dias').replaceChildren(campoLi('nenhum evento no período'))
    return
  }
  $('dias').replaceChildren(
    ...dias.map((d) => {
      const li = document.createElement('li')
      li.className = 'dia'

      const cab = document.createElement('header')
      cab.append(
        campo('data', d.data),
        campo('resumo', `${d.eventos} eventos · ${d.agentes.length || 'nenhum'} agente(s)`),
        // Custo ausente é "sem telemetria", não zero.
        campo('custo', d.custoUsd === null ? 'sem telemetria de custo' : `${d.custoUsd.toFixed(2)} USD`)
      )
      li.append(cab)

      if (d.entregues.length) {
        li.append(linha('entregue', `entregues: ${d.entregues.join(', ')}`))
      }
      if (d.movimentacoes.length) {
        li.append(linha('', d.movimentacoes.map((m) => `${m.card} → ${m.para}`).join(' · ')))
      }
      if (d.agentes.length) li.append(linha('', `agentes: ${d.agentes.join(', ')}`))
      if (d.reprovacoes) li.append(linha('reprovou', `${d.reprovacoes} reprovação(ões) de gate`))
      for (const [card, usd] of Object.entries(d.custoPorCard)) {
        li.append(linha('', `${card}: ${usd.toFixed(2)} USD`))
      }
      return li
    })
  )
}

function linha(classe, texto) {
  const div = document.createElement('div')
  div.className = `linha ${classe}`.trim()
  div.textContent = texto
  return div
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
