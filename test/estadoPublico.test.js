import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Estado } from '../src/estado.js'
import {
  redigirSessoes,
  redigirFluxo,
  escreverEstadoPublico,
  lerEstadoPublico,
  criarPublicadorEstado,
  selecionarParaPublicar,
  sessaoProtegida,
} from '../src/estadoPublico.js'

const dir = () => mkdtempSync(join(tmpdir(), 'sle-publico-'))
const AGORA = Date.parse('2026-09-29T00:00:00Z')

test('redigirSessoes marca ativa pela janela e mantem card/ultimoPasso/eventos', () => {
  const sessoesEstado = [
    { id: 's-viva', projeto: 'cenvia', agente: 'general-purpose', card: 'CARD-118', ultimoPasso: 'tool.post', eventos: 12, ultimo: new Date(AGORA - 60_000).toISOString() },
    { id: 's-parada', projeto: 'billing', card: null, ultimoPasso: 'session.start', eventos: 1, ultimo: new Date(AGORA - 20 * 60_000).toISOString() },
  ]
  const [viva, parada] = redigirSessoes(sessoesEstado, { agora: AGORA, janelaAtivaMs: 10 * 60_000 })
  assert.equal(viva.sessao, 's-viva')
  assert.equal(viva.card, 'CARD-118')
  assert.equal(viva.ultimoPasso, 'tool.post')
  assert.equal(viva.eventos, 12)
  assert.equal(viva.ativa, true)
  assert.equal(parada.ativa, false)
})

test('redigirSessoes: sessao sem ultimo (nunca deveria existir, mas nao explode) conta como inativa', () => {
  const [s] = redigirSessoes([{ id: 'x', ultimo: null }], { agora: AGORA })
  assert.equal(s.ativa, false)
})

test('redigirSessoes: lista vazia ou ausente nao quebra', () => {
  assert.deepEqual(redigirSessoes([]), [])
  assert.deepEqual(redigirSessoes(undefined), [])
})

// CARD-120c: o publicador estava subindo o Estado inteiro -- toda sessao ja
// vista, nao so quem trabalha agora -- e por isso 160 sessoes historicas
// chegavam no arquivo com so 4 `ativa:true`, e o console em modo git lia
// isso como "160 agentes trabalhando".
test('selecionarParaPublicar descarta sessao fora da janela de publicacao, mesmo inativa mas recente', () => {
  const redigidas = redigirSessoes(
    [
      { id: 's-agora', ultimo: new Date(AGORA - 60_000).toISOString() }, // ativa
      { id: 's-de-3h', ultimo: new Date(AGORA - 3 * 3600_000).toISOString() }, // parada, dentro da janela de 6h
      { id: 's-de-ontem', ultimo: new Date(AGORA - 30 * 3600_000).toISOString() }, // parada ha 30h -- fora
    ],
    { agora: AGORA, janelaAtivaMs: 10 * 60_000 }
  )
  const publicadas = selecionarParaPublicar(redigidas, { agora: AGORA, janelaPublicacaoMs: 6 * 3600_000 })
  assert.deepEqual(publicadas.map((s) => s.sessao).sort(), ['s-agora', 's-de-3h'])
})

test('selecionarParaPublicar poe as ativas primeiro', () => {
  const redigidas = redigirSessoes(
    [
      { id: 's-parada', ultimo: new Date(AGORA - 3 * 3600_000).toISOString() },
      { id: 's-ativa', ultimo: new Date(AGORA - 60_000).toISOString() },
    ],
    { agora: AGORA, janelaAtivaMs: 10 * 60_000 }
  )
  const publicadas = selecionarParaPublicar(redigidas, { agora: AGORA, janelaPublicacaoMs: 6 * 3600_000 })
  assert.deepEqual(publicadas.map((s) => s.sessao), ['s-ativa', 's-parada'])
})

// Revisao do PR #7: a janela de publicacao nao pode tirar do arquivo a
// sessao do DEUS nem a dona de um card em `doing` -- ficam publicadas
// (como "recentes", com `ultimo` de horas atras visivel na tela).
test('selecionarParaPublicar mantem sessao do DEUS fora da janela, por id ou por agente', () => {
  const antiga = new Date(AGORA - 30 * 3600_000).toISOString()
  const redigidasPorId = redigirSessoes([{ id: 'deus-abc', ultimo: antiga }], { agora: AGORA })
  const publicadasPorId = selecionarParaPublicar(redigidasPorId, {
    agora: AGORA, janelaPublicacaoMs: 6 * 3600_000, deusSessionId: 'deus-abc',
  })
  assert.equal(publicadasPorId.length, 1)

  const redigidasPorAgente = redigirSessoes([{ id: 'x', agente: 'deus', ultimo: antiga }], { agora: AGORA })
  const publicadasPorAgente = selecionarParaPublicar(redigidasPorAgente, { agora: AGORA, janelaPublicacaoMs: 6 * 3600_000 })
  assert.equal(publicadasPorAgente.length, 1)
})

test('selecionarParaPublicar mantem sessao dona de card em doing fora da janela', () => {
  const redigidas = redigirSessoes(
    [{ id: 'presa', card: 'CARD-042', ultimo: new Date(AGORA - 72 * 3600_000).toISOString() }],
    { agora: AGORA }
  )
  const comProtecao = selecionarParaPublicar(redigidas, {
    agora: AGORA, janelaPublicacaoMs: 6 * 3600_000, cardsEmDoing: new Set(['CARD-042']),
  })
  assert.equal(comProtecao.length, 1)

  const semProtecao = selecionarParaPublicar(redigidas, { agora: AGORA, janelaPublicacaoMs: 6 * 3600_000, cardsEmDoing: new Set() })
  assert.equal(semProtecao.length, 0)
})

test('sessaoProtegida: sem deusSessionId/cardsEmDoing, ninguem e protegido', () => {
  assert.equal(sessaoProtegida({ id: 'qualquer', card: 'CARD-1' }), false)
})

test('selecionarParaPublicar so publica subagente (general-purpose/Explore) enquanto ativo', () => {
  const redigidas = redigirSessoes(
    [
      { id: 'sub-morto', agente: 'general-purpose', ultimo: new Date(AGORA - 30 * 60_000).toISOString() },
      { id: 'sub-vivo', agente: 'Explore', ultimo: new Date(AGORA - 60_000).toISOString() },
      { id: 'mae-parada', agente: 'implementer', ultimo: new Date(AGORA - 30 * 60_000).toISOString() },
    ],
    { agora: AGORA, janelaAtivaMs: 10 * 60_000 }
  )
  const publicadas = selecionarParaPublicar(redigidas, { agora: AGORA, janelaPublicacaoMs: 6 * 3600_000 })
  assert.deepEqual(publicadas.map((s) => s.sessao).sort(), ['mae-parada', 'sub-vivo'])
})

test('redigirFluxo mantem so ts/loop/kind/session -- nunca comando, arquivo ou cwd', () => {
  const fluxo = [
    { ts: '2026-09-29T00:00:00Z', loop: 'L1', kind: 'tool.post', session: 's1', payload: { command: 'rm -rf /', cwd: '/segredo' } },
  ]
  const [e] = redigirFluxo(fluxo)
  assert.deepEqual(e, { ts: '2026-09-29T00:00:00Z', loop: 'L1', kind: 'tool.post', session: 's1' })
  assert.equal(e.payload, undefined)
})

test('redigirFluxo respeita o limite, pegando so os ultimos eventos', () => {
  const fluxo = Array.from({ length: 100 }, (_, i) => ({ ts: `t${i}`, loop: 'L1', kind: 'tool.post', session: 's1' }))
  const cortado = redigirFluxo(fluxo, { limite: 5 })
  assert.equal(cortado.length, 5)
  assert.equal(cortado[0].ts, 't95')
  assert.equal(cortado.at(-1).ts, 't99')
})

test('escreverEstadoPublico grava atomico com sessoes e eventos, lerEstadoPublico devolve o mesmo', () => {
  const f = join(dir(), 'sub', 'sessoes.json')
  const sessoes = [{ sessao: 's [111111]', card: 'CARD-120' }]
  const eventos = [{ ts: '2026-09-29T00:00:00Z', loop: 'L1', kind: 'tool.post', session: 's [111111]' }]
  escreverEstadoPublico(f, { sessoes, eventos })
  const lido = JSON.parse(readFileSync(f, 'utf8'))
  assert.ok(lido.atualizado)
  assert.deepEqual(lido.sessoes, sessoes)
  assert.deepEqual(lido.eventos, eventos)

  const relido = lerEstadoPublico(f)
  assert.deepEqual(relido.sessoes, sessoes)
  assert.deepEqual(relido.eventos, eventos)
})

test('lerEstadoPublico tolera arquivo ausente ou corrompido, nunca lanca', () => {
  const d = dir()
  assert.deepEqual(lerEstadoPublico(join(d, 'nada.json')), { atualizado: null, sessoes: [], eventos: [] })
  const f = join(d, 'ruim.json')
  writeFileSync(f, 'nao é json')
  assert.deepEqual(lerEstadoPublico(f), { atualizado: null, sessoes: [], eventos: [] })
})

test('criarPublicadorEstado publica sessao viva de verdade, com card e ultimoPasso', () => {
  const d = dir()
  const publicoPath = join(d, 'estado-publico', 'sessoes.json')
  const estado = new Estado(join(d, 'dados'))
  estado.registrar({
    ts: new Date().toISOString(), kind: 'session.start', loop: 'L2', card: 'CARD-118',
    agent: null, session: 's1', parent_agent: null, payload: { cwd: '/repo/cenvia' },
  })

  const publicar = criarPublicadorEstado({ estado, publicoPath })
  const { sessoes, mudou } = publicar()
  assert.equal(mudou, true)
  assert.equal(sessoes.length, 1)
  assert.equal(sessoes[0].card, 'CARD-118')
  assert.equal(sessoes[0].ativa, true)
  assert.equal(sessoes[0].ultimoPasso, 'session.start')

  const relido = lerEstadoPublico(publicoPath)
  assert.equal(relido.sessoes[0].card, 'CARD-118')
})

test('criarPublicadorEstado com o mesmo estado nao reescreve o arquivo (revisao do PR #4)', () => {
  const d = dir()
  const publicoPath = join(d, 'estado-publico', 'sessoes.json')
  const estado = new Estado(join(d, 'dados'))
  estado.registrar({
    ts: new Date().toISOString(), kind: 'session.start', loop: 'L2', card: null,
    agent: null, session: 's1', parent_agent: null, payload: {},
  })
  // throttleMs: 0 -- este teste prova a checagem de conteúdo, não o throttle
  // (que tem teste próprio, abaixo, com o relógio sob controle).
  const publicar = criarPublicadorEstado({ estado, publicoPath, throttleMs: 0 })

  const primeira = publicar()
  assert.equal(primeira.mudou, true)
  const carimboAntes = lerEstadoPublico(publicoPath).atualizado

  // Nada de novo aconteceu no Estado -- como o publish-loop de 30s chamaria
  // de novo com a máquina parada. Sem essa checagem, o carimbo de tempo
  // sozinho pareceria mudança e commitaria/empurraria pra sempre.
  const segunda = publicar()
  assert.equal(segunda.mudou, false)
  assert.equal(lerEstadoPublico(publicoPath).atualizado, carimboAntes)

  // Evento novo de verdade -- agora sim precisa escrever.
  estado.registrar({
    ts: new Date().toISOString(), kind: 'tool.post', loop: 'L1', card: 'CARD-042',
    agent: null, session: 's1', parent_agent: null, payload: { tool: 'Edit' },
  })
  const terceira = publicar()
  assert.equal(terceira.mudou, true)
  assert.equal(lerEstadoPublico(publicoPath).sessoes[0].card, 'CARD-042')
})

test('criarPublicadorEstado ignora campo volatil (ultimoPasso) sozinho -- so evento novo do MESMO card nao commita', () => {
  const d = dir()
  const publicoPath = join(d, 'estado-publico', 'sessoes.json')
  const estado = new Estado(join(d, 'dados'))
  estado.registrar({
    ts: new Date().toISOString(), kind: 'session.start', loop: 'L2', card: 'CARD-118',
    agent: null, session: 's1', parent_agent: null, payload: {},
  })
  const publicar = criarPublicadorEstado({ estado, publicoPath, throttleMs: 0 })
  assert.equal(publicar().mudou, true)
  // Primeiro tool.post: e um TIPO novo de passo pra essa sessao no fluxo --
  // conta como mudanca real (uma vez).
  estado.registrar({
    ts: new Date().toISOString(), kind: 'tool.post', loop: 'L1', card: 'CARD-118',
    agent: null, session: 's1', parent_agent: null, payload: { tool: 'Edit' },
  })
  assert.equal(publicar().mudou, true)

  // A partir daqui, sessao ativa mandando `tool.post` atras de `tool.post`,
  // sem trocar de card, agente nem tipo de passo novo -- e exatamente o
  // cenario que a revisao do PR #6 pegou commitando a cada 30s
  // (ultimoPasso/ultimo/eventos mudam sempre, o resto nao).
  for (let i = 0; i < 5; i++) {
    estado.registrar({
      ts: new Date().toISOString(), kind: 'tool.post', loop: 'L1', card: 'CARD-118',
      agent: null, session: 's1', parent_agent: null, payload: { tool: 'Edit' },
    })
    assert.equal(publicar().mudou, false, `tick ${i}: nada estavel mudou, nao pode commitar`)
  }
})

test('criarPublicadorEstado: no maximo 1 escrita a cada throttleMs, mesmo com mudanca real repetida (revisao do PR #6)', () => {
  const d = dir()
  const publicoPath = join(d, 'estado-publico', 'sessoes.json')
  const estado = new Estado(join(d, 'dados'))
  const publicar = criarPublicadorEstado({ estado, publicoPath, throttleMs: 120_000 })

  let t = Date.parse('2026-09-29T00:00:00Z')
  estado.registrar({
    ts: new Date(t).toISOString(), kind: 'session.start', loop: 'L2', card: 'CARD-001',
    agent: null, session: 's1', parent_agent: null, payload: {},
  })
  assert.equal(publicar({ agora: t }).mudou, true, 'primeira escrita nunca e throttled')

  // Card muda de novo (mudanca real de verdade), mas so 10s depois -- dentro do throttle.
  t += 10_000
  estado.registrar({
    ts: new Date(t).toISOString(), kind: 'tool.post', loop: 'L1', card: 'CARD-002',
    agent: null, session: 's1', parent_agent: null, payload: {},
  })
  let r = publicar({ agora: t })
  assert.equal(r.mudou, false, 'throttle segura o commit mesmo com mudanca real')
  assert.equal(lerEstadoPublico(publicoPath).sessoes[0].card, 'CARD-001', 'arquivo ainda tem o estado anterior')

  // Mais uma mudanca real, ainda dentro da janela de 2min.
  t += 10_000
  estado.registrar({
    ts: new Date(t).toISOString(), kind: 'tool.post', loop: 'L1', card: 'CARD-003',
    agent: null, session: 's1', parent_agent: null, payload: {},
  })
  assert.equal(publicar({ agora: t }).mudou, false)

  // Passa da janela: escreve, e com o estado MAIS RECENTE acumulado --
  // nunca um instantaneo intermediario (CARD-002) perdido no meio do caminho.
  t += 120_000
  r = publicar({ agora: t })
  assert.equal(r.mudou, true)
  assert.equal(lerEstadoPublico(publicoPath).sessoes[0].card, 'CARD-003')
})
