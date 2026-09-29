// Tela da Fase 2: observar e ler. Nada aqui escreve no daemon.
const CORES = { L1: '#4aa3df', L2: '#c08b3e', L3: '#7b5ec7' }
const COLUNAS = ['backlog', 'pendente-diego', 'refinamento', 'aprovado', 'doing', 'review', 'done', 'recurring']
// Só a coluna de decisão do Diego precisa de rótulo -- as demais já se leem pelo próprio id.
const ROTULOS = { 'pendente-diego': 'Pendentes do Diego' }
const eventos = []
// IDs das sessões ativas na última pintura -- a régua usa pra saber que
// traço é de trabalho de agora e que traço é eco de sessão parada. Precisa
// estar aqui em cima (não perto de `pintarSessoes`): o `mostrar()` do load
// inicial chama `pintarRegua()`, que lê esta variável, antes do resto do
// arquivo terminar de rodar -- `let` mais abaixo ainda estaria em TDZ.
let sessoesAtivasIds = new Set()
let indice = { board: {}, cards: [] }
// Filtro de prioridade do board (CARD-120). Conjunto vazio == "todas" --
// nunca esconde nada; marcar um ou mais P's é escolha explícita de quem olha.
// Rótulo e cor duplicam src/prioridade.js e style.css de propósito: a tela é
// HTML/JS puro, sem bundler, então não há como importar o módulo do servidor
// aqui -- o mapa é pequeno e os 3 lugares mudam juntos (Boy Scout se um dia
// isso ganhar build step).
const PRIORIDADES = ['P-1', 'P0', 'P1', 'P2', 'P3']
const ROTULOS_PRIORIDADE = { 'P-1': 'URGENTE', P0: 'ALTÍSSIMA', P1: 'ALTA', P2: 'MÉDIA', P3: 'BAIXA' }
const CORES_PRIORIDADE = { 'P-1': '#7f1d1d', P0: '#b91c1c', P1: '#c2410c', P2: '#a16207', P3: '#4b5563' }

/** `?p=P0,P1` -> `Set(['P0','P1'])`; querystring ausente ou só lixo == "todas". */
function lerFiltroPrioridadeDaUrl() {
  const bruto = new URL(location.href).searchParams.get('p')
  if (!bruto) return new Set()
  return new Set(
    bruto.split(',').map((s) => s.trim().toUpperCase()).filter((p) => PRIORIDADES.includes(p))
  )
}

/** Grava o filtro atual em `?p=...` sem mexer no resto da URL (projeto, aba) e
 *  sem empilhar histórico -- um clique no chip não é uma navegação. */
function escreverFiltroPrioridadeNaUrl() {
  const url = new URL(location.href)
  if (filtroPrioridade.size) url.searchParams.set('p', [...filtroPrioridade].join(','))
  else url.searchParams.delete('p')
  history.replaceState({}, '', url.pathname + url.search)
}

let filtroPrioridade = lerFiltroPrioridadeDaUrl()
// Projeto observado. Vai em toda chamada de leitura, para a tela nunca mostrar
// o board de um projeto com o git de outro.
let projetoAtual = null
const comProjeto = (rota) =>
  projetoAtual ? `${rota}${rota.includes('?') ? '&' : '?'}projeto=${encodeURIComponent(projetoAtual)}` : rota

const $ = (id) => document.getElementById(id)

// As mesmas abas do nav são rotas de verdade -- refresh na aba tem que voltar
// pra ela, não sempre pro Fluxo.
const TELAS = ['fluxo', 'board', 'editar', 'controle', 'metricas', 'historico']
const TELA_PADRAO = 'fluxo'

function urlComProjeto(caminho) {
  return projetoAtual ? `${caminho}?projeto=${encodeURIComponent(projetoAtual)}` : caminho
}

function mostrar(tela, { navegar = true } = {}) {
  for (const s of document.querySelectorAll('main > section')) s.hidden = s.id !== `tela-${tela}`
  for (const b of document.querySelectorAll('nav button')) b.classList.toggle('ativa', b.dataset.tela === tela)
  if (navegar) history.pushState({}, '', urlComProjeto(`/${tela}`))
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

/** Aba pedida pela URL -- `/board`, `/metricas`… -- ou `null` se não é uma
 *  dessas rotas (ex.: `/card/<id>`, que abre por cima da aba padrão). */
function telaNaUrl() {
  const nome = location.pathname.replace(/^\//, '')
  return TELAS.includes(nome) ? nome : null
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
  pintarForaDoBoard(s.sessoes)
} catch (e) {
  console.error('sle: falha ao montar o estado inicial', e)
} finally {
  // Sinal explicito de que o JS montou: o HTML sozinho ja tem os botoes, entao
  // esperar por eles nao prova que os listeners existem.
  document.body.dataset.pronto = 'sim'
}

// A aba vem da URL no load (F5 fica onde estava); "/card/<id>" abre o modal
// por cima do Board, que é a aba de onde os cards se abrem.
mostrar(telaNaUrl() ?? (idDoCardNaUrl() ? 'board' : TELA_PADRAO), { navegar: false })
const idInicial = idDoCardNaUrl()
if (idInicial) abrirCard(idInicial)
window.addEventListener('popstate', () => {
  const id = idDoCardNaUrl()
  if (id) abrirCard(id)
  else fecharModal()
  const tela = telaNaUrl()
  if (tela) mostrar(tela, { navegar: false })
})

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
  const s = await (await fetch(comProjeto('/api/snapshot'))).json()
  pintarForaDoBoard(s.sessoes)
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
    history.replaceState({}, '', urlComProjeto(location.pathname))
    await recarregarIndice()
    if (!$('tela-editar').hidden) pintarArquivos()
    if (!$('tela-controle').hidden) pintarControle()
  })
  // F5 na URL com ?projeto=... sobrevive: a querystring vence o default do
  // servidor, senão trocar de aba sempre voltava pro primeiro projeto.
  const pedido = new URL(location.href).searchParams.get('projeto')
  if (pedido && [...sel.options].some((o) => o.value === pedido)) {
    projetoAtual = pedido
    sel.value = pedido
  }
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

function liDeSessao(s, { morta }) {
  const li = document.createElement('li')
  if (morta) li.className = 'morta'
  li.append(campo('id', s.agente ?? s.projeto ?? (s.id ?? '').slice(0, 8)), campo('meta', metaDeSessao(s)))
  return li
}

/**
 * "Trabalhando agora" é só `ativa:true` -- contador e lista principal. O
 * resto (sessão de horas atrás que a janela de publicação do CARD-120c
 * ainda deixa passar) vai pra uma seção recolhida: existe pra quem quer
 * olhar o rastro recente, não pra inflar "N agentes trabalhando" com
 * sessão que já parou (era assim que 160 sessões publicadas viravam "160
 * agentes trabalhando" com só 4 de verdade ativas).
 */
function pintarSessoes(sessoes) {
  if (!sessoes) return
  const ativas = sessoes.filter((s) => s.ativa)
  const recentes = sessoes.filter((s) => !s.ativa)
  sessoesAtivasIds = new Set(ativas.map((s) => s.id ?? s.sessao))

  $('sessoes-contagem').textContent = sessoes.length ? `${ativas.length} trabalhando agora` : ''
  $('sessoes').replaceChildren(
    ...(ativas.length
      ? ativas.map((s) => liDeSessao(s, { morta: false }))
      : [Object.assign(document.createElement('li'), { className: 'vazio', textContent: 'nenhum agente trabalhando agora' })])
  )

  const painelRecentes = $('sessoes-recentes-painel')
  $('sessoes-recentes-contagem').textContent = recentes.length
  painelRecentes.hidden = recentes.length === 0
  $('sessoes-recentes').replaceChildren(...recentes.map((s) => liDeSessao(s, { morta: true })))
}

/**
 * Sessão vista por hook local ou por `estado-publico/sessoes.json` (CARD-120
 * -- console em modo git, sem hook alcançável): mesmo shape nos dois casos
 * (`card`, `ultimoPasso`, `eventos`), a tela não precisa saber a diferença.
 */
function metaDeSessao(s) {
  const partes = []
  if (s.card) partes.push(s.card)
  if (s.ultimoPasso) partes.push(s.ultimoPasso)
  if (s.eventos != null) partes.push(`${s.eventos} eventos`)
  partes.push(s.ativa ? (s.inativoMs != null ? `há ${idade(s.inativoMs)}` : 'ativa') : 'inativa')
  return partes.join(' · ')
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

/**
 * O board é o trabalho PLANEJADO. Quase todo trabalho de agente acontece sem
 * card — e um board com dois cards, sem dizer isso, parece o retrato completo.
 */
function pintarForaDoBoard(sessoes) {
  const semCard = (sessoes ?? []).filter((s) => s.ativa)
  const aviso = $('fora-do-board')
  if (!semCard.length) return (aviso.hidden = true)

  const onde = [...new Set(semCard.map((s) => s.projeto ?? s.id.slice(0, 8)))]
  aviso.hidden = false
  aviso.replaceChildren(
    document.createTextNode(`${semCard.length} agente(s) trabalhando agora `),
    Object.assign(document.createElement('b'), { textContent: 'sem card' }),
    document.createTextNode(`, em: ${onde.join(', ')}. `),
    document.createTextNode('O board mostra o trabalho planejado; a execução está em Fluxo e Histórico.')
  )
}

/** Quantos cards (de todas as colunas) tem cada P -- o número no chip é a
 *  resposta direta a "cadê as de prioridade alta?": não precisa abrir nada
 *  pra saber se tem 1 ou 20. */
function contarPorPrioridade() {
  const contagem = Object.fromEntries(PRIORIDADES.map((p) => [p, 0]))
  for (const c of indice.cards ?? []) {
    const p = c.prioridade ?? 'P3'
    if (p in contagem) contagem[p]++
  }
  return contagem
}

function alternarFiltroPrioridade(p) {
  if (p == null) filtroPrioridade.clear()
  else if (filtroPrioridade.has(p)) filtroPrioridade.delete(p)
  else filtroPrioridade.add(p)
  escreverFiltroPrioridadeNaUrl()
  pintarBoard()
}

function montarFiltroPrioridade() {
  const cont = $('filtro-prioridade')
  if (!cont) return
  const contagem = contarPorPrioridade()
  const total = (indice.cards ?? []).length

  const todas = document.createElement('button')
  todas.type = 'button'
  todas.className = 'chip-prioridade chip-todas'
  todas.textContent = `todas (${total})`
  todas.setAttribute('aria-pressed', String(filtroPrioridade.size === 0))
  todas.addEventListener('click', () => alternarFiltroPrioridade(null))

  const chips = PRIORIDADES.map((p) => {
    const b = document.createElement('button')
    b.type = 'button'
    b.className = `chip-prioridade prioridade-${p}`
    b.title = p
    b.dataset.p = p
    b.textContent = `${ROTULOS_PRIORIDADE[p]} (${contagem[p]})`
    b.setAttribute('aria-pressed', String(filtroPrioridade.has(p)))
    b.addEventListener('click', () => alternarFiltroPrioridade(p))
    return b
  })
  cont.replaceChildren(todas, ...chips)
}

function pintarBoard() {
  montarFiltroPrioridade()
  const passaNoFiltro = (c) => filtroPrioridade.size === 0 || filtroPrioridade.has(c.prioridade ?? 'P3')
  $('colunas').replaceChildren(
    ...COLUNAS.map((coluna) => {
      const cards = (indice.board?.[coluna] ?? []).filter(passaNoFiltro)
      const div = document.createElement('div')
      div.className = 'coluna'
      div.dataset.coluna = coluna

      const h = document.createElement('h3')
      h.append(campo('nome', ROTULOS[coluna] ?? coluna), campo('qtd', String(cards.length)))
      const lista = document.createElement('div')
      lista.append(...cards.map(botaoDeCard))
      div.append(h, lista)
      return div
    })
  )
}

/** O selo grande e colorido (CARD-120) -- mesmo elemento no card e no modal,
 *  só muda a posição (absoluta no card, inline no modal, via CSS). */
function seloPrioridade(p) {
  const s = campo(`selo-prioridade prioridade-${p}`, ROTULOS_PRIORIDADE[p] ?? p)
  s.title = p
  return s
}

function botaoDeCard(c) {
  // Link de verdade: Ctrl+clique/clique do meio abre em nova guia sozinho,
  // sem JS nenhum. Clique normal intercepta e abre o modal.
  const p = c.prioridade ?? 'P3'
  const b = document.createElement('a')
  b.href = `/card/${encodeURIComponent(c.id)}`
  b.className = `card risco-${c.risk ?? 'baixo'}`
  b.dataset.card = c.id
  // A cor da borda é da prioridade, não do risco (CARD-120) -- inline pra
  // vencer a cor de risco do CSS sem precisar tirar a classe risco-* do card
  // (outro teste do board depende de achá-la).
  b.style.borderLeftColor = CORES_PRIORIDADE[p] ?? CORES_PRIORIDADE.P3
  // Na visão de todos, o card diz de que projeto veio.
  const filhos = []
  if (c.coluna === 'pendente-diego') filhos.push(campo('selo-decisao', 'AGUARDA VOCÊ'))
  filhos.push(
    seloPrioridade(p),
    campo('cid', c.rotuloProjeto ? `${c.rotuloProjeto} · ${c.id}` : c.id),
    campo('titulo', c.title ?? '')
  )
  b.append(...filhos)
  b.addEventListener('click', (ev) => {
    if (ev.ctrlKey || ev.metaKey || ev.shiftKey || ev.button === 1) return
    ev.preventDefault()
    abrirCard(c.id)
  })

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

function inline(s) {
  return s.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/`([^`]+)`/g, '<code>$1</code>')
}

/** Escapa e converte um subconjunto simples de markdown -- títulos, listas,
 *  negrito, código inline. `## Opções` vira cartões clicáveis (A/B/C…), e
 *  esses cartões mais "decidir"/"recomendação" ficam num bloco em destaque:
 *  é a única pergunta que o Diego veio ao modal para responder. */
function markdownSeguro(texto) {
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const linhas = esc(texto).split('\n')
  const html = []
  let listaAberta = false
  let opcoesAbertas = false
  let decisaoAberta = false
  let emSecaoOpcoes = false

  const fecharLista = () => { if (listaAberta) { html.push('</ul>'); listaAberta = false } }
  const fecharOpcoes = () => { if (opcoesAbertas) { html.push('</div>'); opcoesAbertas = false } }

  for (const linha of linhas) {
    const titulo = /^(#{1,6})\s+(.*)$/.exec(linha)
    // O card real escreve "- A: texto" (lista com dois-pontos), não "A) texto".
    const itemOpcao = emSecaoOpcoes && /^-?\s*([A-Z])[):]\s*(.*)$/.exec(linha)
    const item = !itemOpcao && /^[-*]\s+(.*)$/.exec(linha)

    if (titulo) {
      fecharLista()
      fecharOpcoes()
      const textoTitulo = titulo[2]
      const ehDecisao = /decidir|op[cç][aã]o|op[cç][ãõo]es|recomenda/i.test(textoTitulo)
      if (ehDecisao && !decisaoAberta) { html.push('<div class="bloco-decisao">'); decisaoAberta = true }
      else if (!ehDecisao && decisaoAberta) { html.push('</div>'); decisaoAberta = false }
      emSecaoOpcoes = /op[cç][ãõo]es/i.test(textoTitulo)
      const n = Math.min(titulo[1].length + 1, 6)
      html.push(`<h${n}>${inline(textoTitulo)}</h${n}>`)
      continue
    }
    if (itemOpcao) {
      if (!opcoesAbertas) { html.push('<div class="cartoes-opcao">'); opcoesAbertas = true }
      const rotulo = `${itemOpcao[1]}) ${itemOpcao[2]}`
      html.push(`<button type="button" class="cartao-opcao" data-opcao="${rotulo.replace(/"/g, '&quot;')}">${inline(rotulo)}</button>`)
      continue
    }
    fecharOpcoes()
    if (item) {
      if (!listaAberta) { html.push('<ul>'); listaAberta = true }
      html.push(`<li>${inline(item[1])}</li>`)
      continue
    }
    fecharLista()
    if (linha.trim() === '') continue
    html.push(`<p>${inline(linha)}</p>`)
  }
  fecharLista()
  fecharOpcoes()
  if (decisaoAberta) html.push('</div>')
  return html.join('\n')
}

/** "2026-09-28T18:00…" -> "28/09 18:00"; formato que não bate cai como veio. */
function formatarQuandoPrazo(p) {
  if (!p) return null
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(String(p))
  return m ? `${m[3]}/${m[2]} ${m[4]}:${m[5]}` : String(p)
}

function chip(texto) {
  return campo('chip', texto)
}

let cardAberto = null
// De onde o modal foi aberto -- pra onde o ✕ volta. Sem isto, fechar sempre
// caía em "/" em vez da aba (e do ?projeto=) de onde o card foi clicado.
let origemModal = null

function capturarOrigemDoModal() {
  if (!location.pathname.startsWith('/card/')) {
    origemModal = location.pathname + location.search
  } else if (!origemModal) {
    // Carregou direto em /card/<id> (link, nova guia): a origem é o Board.
    origemModal = '/board' + location.search
  }
}

// Quem tinha o foco antes do modal (o card clicado): recebe o foco de volta ao fechar.
let focoAntesDoModal = null

const SELETOR_FOCAVEL = 'a[href],button:not([disabled]),textarea:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])'

function focaveisDoModal() {
  return [...$('modal-card').querySelectorAll(SELETOR_FOCAVEL)].filter((e) => e.offsetParent !== null)
}

/** Mostra o modal e leva o foco pra dentro (no ✕: o alvo mais seguro). */
function exibirModal() {
  if ($('modal-card').hidden) {
    const ativo = document.activeElement
    focoAntesDoModal = ativo && ativo !== document.body ? ativo : null
  }
  $('modal-card').hidden = false
  $('modal-fechar').focus()
}

/** Tab/Shift+Tab circulam dentro do modal em vez de escapar pro board. */
function prenderFoco(ev) {
  const f = focaveisDoModal()
  if (!f.length) return
  const primeiro = f[0]
  const ultimo = f[f.length - 1]
  const dentro = $('modal-card').contains(document.activeElement)
  if (ev.shiftKey && (document.activeElement === primeiro || !dentro)) {
    ev.preventDefault()
    ultimo.focus()
  } else if (!ev.shiftKey && (document.activeElement === ultimo || !dentro)) {
    ev.preventDefault()
    primeiro.focus()
  }
}

function devolverFoco() {
  const alvo = focoAntesDoModal
  focoAntesDoModal = null
  if (!alvo) return
  // O board pode ter sido repintado (SSE) e o nó antigo saiu do DOM: acha o card pelo id.
  const vivo = alvo.isConnected ? alvo : alvo.dataset?.card
    ? document.querySelector(`[data-card="${CSS.escape(alvo.dataset.card)}"]`) : null
  vivo?.focus({ preventScroll: true })
}

async function abrirCard(id) {
  capturarOrigemDoModal()
  let c = indice.cards.find((x) => x.id === id)
  if (!c) {
    try {
      const r = await fetch(comProjeto(`/api/cards/${encodeURIComponent(id)}`))
      if (!r.ok) return erroDeCard(id)
      c = await r.json()
    } catch {
      return erroDeCard(id)
    }
  }
  cardAberto = c
  document.querySelector('.modal-resposta').hidden = false
  history.pushState({}, '', `/card/${encodeURIComponent(id)}${location.search}`)

  $('modal-id').textContent = c.id
  $('modal-selo').hidden = c.coluna !== 'pendente-diego'
  $('modal-selo').textContent = 'AGUARDA VOCÊ'
  $('modal-titulo').textContent = c.title ?? ''
  $('modal-nova-guia').href = `/card/${encodeURIComponent(id)}${location.search}`

  // Só metadado preenchido vira chip -- "prioridade —" não ajuda ninguém.
  const chips = []
  if (c.owner) chips.push(chip(c.owner))
  const prazo = formatarQuandoPrazo(c.prazo)
  if (prazo) chips.push(chip(`prazo ${prazo}`))
  if (c.prioridade) chips.push(seloPrioridade(c.prioridade))
  if (c.modelo) chips.push(chip(c.modelo))
  $('modal-meta').replaceChildren(...chips)

  $('modal-corpo').innerHTML = markdownSeguro(c.corpo ?? '')
  pintarRespostas(c)
  pintarSeletorOpcoes(c)
  $('modal-resolver').hidden = c.coluna !== 'pendente-diego'
  exibirModal()
}

/** Card não achado ou rede falhou: o modal abre mesmo assim, com o ✕ vivo --
 *  travar sem mensagem foi o bug real que o Diego reportou. */
function erroDeCard(id) {
  cardAberto = null
  $('modal-id').textContent = id
  $('modal-selo').hidden = true
  $('modal-titulo').textContent = 'Não encontrado'
  $('modal-nova-guia').href = `/card/${encodeURIComponent(id)}`
  $('modal-meta').replaceChildren()
  $('modal-corpo').innerHTML = `<p>Não achei o card <b>${id}</b> em nenhum projeto observado.</p>`
  $('modal-respostas').replaceChildren()
  $('modal-resposta-opcoes').replaceChildren()
  document.querySelector('.modal-resposta').hidden = true
  exibirModal()
}

function fecharModal() {
  document.querySelector('.modal-resposta').hidden = false
  $('modal-card').hidden = true
  devolverFoco()
  cardAberto = null
  // Só mexe na URL se ela ainda for a do card -- um fechamento por popstate já
  // chegou com a URL de destino trocada pelo próprio navegador.
  if (location.pathname.startsWith('/card/')) history.replaceState({}, '', origemModal ?? '/board')
  origemModal = null
}

/** Sem "A/B/C" nenhuma (só "Outra" sobra) e sem sequer as seções de decisão no
 *  corpo -- não tem o que estruturar, e fingir que tem só confunde. */
function temSecaoDeDecisao(corpo) {
  return /^##\s*(.*(?:decidir|op[cç][aã]o|op[cç][ãõo]es|recomenda).*)$/im.test(corpo ?? '')
}

function pintarSeletorOpcoes(c) {
  const wrap = $('modal-resposta-opcoes')
  const opcoes = c.opcoes ?? ['Outra']
  const semEstrutura = opcoes.length === 1 && opcoes[0] === 'Outra' && !temSecaoDeDecisao(c.corpo)
  if (semEstrutura) {
    const aviso = document.createElement('p')
    aviso.className = 'aviso-sem-opcoes'
    aviso.textContent = 'Este card não tem opções estruturadas — escreva sua resposta.'
    wrap.replaceChildren(aviso)
    return
  }
  wrap.replaceChildren(...opcoes.map((o) => {
    const label = document.createElement('label')
    const input = document.createElement('input')
    input.type = 'radio'
    input.name = 'resposta-opcao'
    input.value = o
    input.addEventListener('change', () => selecionarOpcao(o))
    label.append(input, document.createTextNode(o))
    return label
  }))
}

/** Cartão A/B/C do corpo e rádio do rodapé são a mesma escolha -- clicar
 *  qualquer um dos dois marca os dois. */
function selecionarOpcao(valor) {
  for (const r of $('modal-resposta-opcoes').querySelectorAll('input[type=radio]')) {
    r.checked = r.value === valor
  }
  for (const el of $('modal-corpo').querySelectorAll('.cartao-opcao')) {
    el.classList.toggle('selecionada', el.dataset.opcao === valor)
  }
}

/** Respostas já registradas no corpo, lidas de volta -- não duplica estado,
 *  o arquivo já é a verdade. */
function pintarRespostas(c) {
  const alvo = $('modal-respostas')
  const blocos = [...(c.corpo ?? '').matchAll(/## Resposta do Diego \(([^)]+)\)\n\*\*Opção:\*\* (.*)\n([\s\S]*?)(?=\n## |$)/g)]
  if (!blocos.length) return alvo.replaceChildren()
  const titulo = document.createElement('h3')
  titulo.textContent = 'Respostas anteriores'
  alvo.replaceChildren(titulo, ...blocos.map(([, quando, opcao, texto]) => {
    const p = document.createElement('p')
    p.className = 'resposta-diego'
    const b = document.createElement('b')
    b.textContent = `${formatarQuandoPrazo(quando.replace(' ', 'T')) ?? quando} — ${opcao}`
    p.append(b, document.createTextNode(texto.trim()))
    return p
  }))
}

let toastTimer = null
function toast(msg) {
  const el = $('toast')
  el.textContent = msg
  el.hidden = false
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => { el.hidden = true }, 2500)
}

$('modal-fechar').addEventListener('click', fecharModal)
$('modal-card').addEventListener('click', (ev) => {
  if (ev.target === $('modal-card')) fecharModal()
})
document.addEventListener('keydown', (ev) => {
  if ($('modal-card').hidden) return
  if (ev.key === 'Escape') fecharModal()
  else if (ev.key === 'Tab') prenderFoco(ev)
})
$('modal-corpo').addEventListener('click', (ev) => {
  const b = ev.target.closest('.cartao-opcao')
  if (b) selecionarOpcao(b.dataset.opcao)
})

function respostaAtual() {
  const marcada = $('modal-resposta-opcoes').querySelector('input[type=radio]:checked')
  return { option: marcada ? marcada.value : '', text: $('modal-resposta-texto').value.trim() }
}

$('modal-resposta-registrar').addEventListener('click', async () => {
  if (!cardAberto) return
  const { option, text } = respostaAtual()
  if (!option && !text) return
  const r = await fetch(comProjeto(`/api/cards/${encodeURIComponent(cardAberto.id)}/answer`), {
    method: 'POST',
    body: JSON.stringify({ option, text }),
  })
  if (!r.ok) return
  $('modal-resposta-texto').value = ''
  toast('Registrado')
  await recarregarIndice()
  await abrirCard(cardAberto.id)
})

$('modal-resolver').addEventListener('click', async () => {
  if (!cardAberto) return
  const { option, text } = respostaAtual()
  const r = await fetch(comProjeto(`/api/cards/${encodeURIComponent(cardAberto.id)}/resolve`), {
    method: 'POST',
    body: JSON.stringify({ option, text }),
  })
  if (!r.ok) return
  toast('Pendência resolvida')
  fecharModal()
  await recarregarIndice()
})

// Carrega direto num card quando a URL chega como /card/<id> ou #card=<id>.
function idDoCardNaUrl() {
  const m = /^\/card\/([^/]+)/.exec(location.pathname)
  if (m) return decodeURIComponent(m[1])
  const h = /card=([^&]+)/.exec(location.hash)
  return h ? decodeURIComponent(h[1]) : null
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
        campo('det', a.rotuloProjeto ?? a.provider ?? '')
      )
      const b = document.createElement('button')
      b.textContent = 'Rodar'
      b.dataset.rodar = a.id
      b.addEventListener('click', async () => {
        // Na visão de todos, rodar exige dizer em qual projeto o agente vive.
        const onde = a.caminhoProjeto ? `?projeto=${encodeURIComponent(a.caminhoProjeto)}` : ''
        await fetch(`/api/agents/${encodeURIComponent(a.id)}/run${onde}`, { method: 'POST' })
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
  atividadePorProjeto: 'atividade por projeto',
  ferramentasMaisUsadas: 'ferramentas mais usadas',
  taxaDeFalhaDeComando: 'taxa de falha de comando',
  picoDeSessoesSimultaneas: 'pico de agentes simultâneos',
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
  if (chave === 'taxaDeEscalonamento' || chave === 'taxaDeFalhaDeComando') {
    return `${(valor * 100).toFixed(0)}%`
  }
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

/**
 * Mesmo corte de "trabalhando agora" da lista de Agentes (CARD-120c): evento
 * sem sessão (decisão de gate, movimento de card) sempre entra -- é
 * atividade do sistema, não de uma sessão que pode estar parada; evento COM
 * sessão só entra se aquela sessão está entre as ativas da última pintura.
 * Sem este corte a régua de uma sessão de véspera continuava desenhando
 * traço ao lado da sessão de agora, como se as duas estivessem no mesmo
 * turno de trabalho.
 */
function eventosParaRegua() {
  return eventos.filter((e) => !e.session || sessoesAtivasIds.has(e.session))
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
  const traco = eventosParaRegua()
  if (!traco.length) return

  const faixas = ['L1', 'L2', 'L3']
  const t0 = Date.parse(traco[0].ts)
  const t1 = Math.max(Date.parse(traco.at(-1).ts), t0 + 1000)
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
    for (const e of traco) {
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
