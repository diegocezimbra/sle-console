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
  publicarEstadoAtivo,
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

test('publicarEstadoAtivo publica sessao viva de verdade, com card e ultimoPasso', () => {
  const d = dir()
  const publicoPath = join(d, 'estado-publico', 'sessoes.json')
  const estado = new Estado(join(d, 'dados'))
  estado.registrar({
    ts: new Date().toISOString(), kind: 'session.start', loop: 'L2', card: 'CARD-118',
    agent: null, session: 's1', parent_agent: null, payload: { cwd: '/repo/cenvia' },
  })

  const { sessoes, mudou } = publicarEstadoAtivo({ estado, publicoPath })
  assert.equal(mudou, true)
  assert.equal(sessoes.length, 1)
  assert.equal(sessoes[0].card, 'CARD-118')
  assert.equal(sessoes[0].ativa, true)
  assert.equal(sessoes[0].ultimoPasso, 'session.start')

  const relido = lerEstadoPublico(publicoPath)
  assert.equal(relido.sessoes[0].card, 'CARD-118')
})

test('publicarEstadoAtivo com o mesmo estado nao reescreve o arquivo (revisao do PR #4)', () => {
  const d = dir()
  const publicoPath = join(d, 'estado-publico', 'sessoes.json')
  const estado = new Estado(join(d, 'dados'))
  estado.registrar({
    ts: new Date().toISOString(), kind: 'session.start', loop: 'L2', card: null,
    agent: null, session: 's1', parent_agent: null, payload: {},
  })

  const primeira = publicarEstadoAtivo({ estado, publicoPath })
  assert.equal(primeira.mudou, true)
  const carimboAntes = lerEstadoPublico(publicoPath).atualizado

  // Nada de novo aconteceu no Estado -- como o publish-loop de 30s chamaria
  // de novo com a máquina parada. Sem essa checagem, o carimbo de tempo
  // sozinho pareceria mudança e commitaria/empurraria pra sempre.
  const segunda = publicarEstadoAtivo({ estado, publicoPath })
  assert.equal(segunda.mudou, false)
  assert.equal(lerEstadoPublico(publicoPath).atualizado, carimboAntes)

  // Evento novo de verdade -- agora sim precisa escrever.
  estado.registrar({
    ts: new Date().toISOString(), kind: 'tool.post', loop: 'L1', card: 'CARD-042',
    agent: null, session: 's1', parent_agent: null, payload: { tool: 'Edit' },
  })
  const terceira = publicarEstadoAtivo({ estado, publicoPath })
  assert.equal(terceira.mudou, true)
  assert.equal(lerEstadoPublico(publicoPath).sessoes[0].card, 'CARD-042')
})
