import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, appendFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Estado } from '../src/estado.js'

const dir = () => mkdtempSync(join(tmpdir(), 'sle-'))
const ev = (over = {}) => ({
  ts: new Date().toISOString(), kind: 'tool.post', loop: 'L1', card: null,
  agent: null, session: 's1', parent_agent: null,
  payload: { tool: 'Edit', file: 'a.ts', ok: true, ms: 10 }, ...over,
})

test('o disco e a verdade: todo evento vai para o JSONL append-only', () => {
  const d = dir()
  const e = new Estado(d)
  e.registrar(ev())
  e.registrar(ev({ session: 's2' }))
  const linhas = readFileSync(join(d, 'events.jsonl'), 'utf8').trim().split('\n')
  assert.equal(linhas.length, 2)
  assert.equal(JSON.parse(linhas[1]).session, 's2')
})

test('o snapshot conhece as sessoes vivas e o que cada uma fez', () => {
  const e = new Estado(dir())
  e.registrar(ev({ kind: 'session.start', session: 's1' }))
  e.registrar(ev({ session: 's1' }))
  e.registrar(ev({ session: 's1' }))
  const s = e.snapshot()
  assert.equal(s.sessoes.length, 1)
  assert.equal(s.sessoes[0].id, 's1')
  assert.equal(s.sessoes[0].eventos, 3)
  assert.equal(s.sessoes[0].ativa, true)
})

test('sessao sem evento ha muito tempo deixa de ser ativa, mesmo sem SessionEnd', () => {
  const e = new Estado(dir(), { ttlMs: 60000 })
  const antiga = new Date(Date.now() - 5 * 60000).toISOString()
  e.registrar(ev({ session: 'fantasma', ts: antiga }))
  e.registrar(ev({ session: 'viva' }))

  const s = e.snapshot()
  const porId = Object.fromEntries(s.sessoes.map((x) => [x.id, x.ativa]))
  assert.equal(porId.fantasma, false, 'a maioria das sessoes nunca manda SessionEnd')
  assert.equal(porId.viva, true)
})

test('as sessoes vem da mais recente para a mais antiga', () => {
  const e = new Estado(dir())
  e.registrar(ev({ session: 'antiga', ts: new Date(Date.now() - 60000).toISOString() }))
  e.registrar(ev({ session: 'nova' }))
  assert.deepEqual(e.snapshot().sessoes.map((s) => s.id), ['nova', 'antiga'])
})

test('a sessao ganha o nome do projeto em que trabalha, e nao so o uuid', () => {
  const e = new Estado(dir())
  e.registrar(ev({ session: 'abc-123', kind: 'session.start',
    payload: { cwd: '/home/dev/projetos/13-chatomnichannel' } }))
  assert.equal(e.snapshot().sessoes[0].projeto, '13-chatomnichannel')
})

test('SessionEnd apaga o agente no painel', () => {
  const e = new Estado(dir())
  e.registrar(ev({ kind: 'session.start' }))
  e.registrar(ev({ kind: 'session.end' }))
  assert.equal(e.snapshot().sessoes[0].ativa, false)
})

test('evento de sistema nao vira sessao fantasma no painel de agentes', () => {
  const e = new Estado(dir())
  e.registrar(ev({ kind: 'session.start', session: 's1' }))
  e.registrar(ev({ kind: 'gate.decidido', session: null, payload: { gate: 'G1', decisao: 'passou' } }))
  e.registrar(ev({ kind: 'card.move', session: null, card: 'CARD-1', payload: { para: 'done' } }))

  const s = e.snapshot()
  assert.equal(s.sessoes.length, 1, 'decisao de gate nao e um agente')
  assert.equal(s.sessoes[0].id, 's1')
  assert.equal(s.fluxo.length, 3, 'mas os eventos continuam no fluxo')
})

test('o fluxo guarda os ultimos eventos, sem crescer para sempre', () => {
  const e = new Estado(dir(), { janela: 3 })
  for (let i = 0; i < 10; i++) e.registrar(ev({ payload: { tool: `T${i}` } }))
  const f = e.snapshot().fluxo
  assert.equal(f.length, 3)
  assert.equal(f.at(-1).payload.tool, 'T9', 'o mais recente por ultimo')
})

test('falha de ferramenta aparece separada no contador', () => {
  const e = new Estado(dir())
  e.registrar(ev({ payload: { tool: 'Bash', ok: false } }))
  e.registrar(ev({ payload: { tool: 'Bash', ok: true } }))
  assert.equal(e.snapshot().contadores.falhas, 1)
})

test('o grafo de agentes sai das arestas pai-filho', () => {
  const e = new Estado(dir())
  e.registrar(ev({ kind: 'subagent.start', session: 'sub', agent: 'reviewer', parent_agent: 's1' }))
  const g = e.snapshot().grafo
  // Quando o harness diz o nome, o nó é o nome; `anonimo` marca quando não diz.
  assert.deepEqual(g, [{ de: 's1', para: 'reviewer', agente: 'reviewer', anonimo: false }])
})

test('reinicio nao perde historia: o estado remonta do JSONL', () => {
  const d = dir()
  const um = new Estado(d)
  um.registrar(ev({ kind: 'session.start', session: 's9' }))
  const dois = new Estado(d)
  assert.equal(dois.snapshot().sessoes[0].id, 's9')
})

test('linha corrompida no JSONL nao cega o daemon', () => {
  const d = dir()
  new Estado(d).registrar(ev({ session: 'boa' }))
  appendFileSync(join(d, 'events.jsonl'), '{quebrado\n')
  assert.equal(new Estado(d).snapshot().sessoes[0].id, 'boa')
})

test('CARD-120: a sessao guarda o card (sticky) e o tipo do ultimo evento', () => {
  const e = new Estado(dir())
  e.registrar(ev({ session: 's1', kind: 'session.start', card: 'CARD-120' }))
  e.registrar(ev({ session: 's1', kind: 'tool.post', card: null })) // sem card no evento: mantem o anterior
  const s = e.snapshot().sessoes[0]
  assert.equal(s.card, 'CARD-120')
  assert.equal(s.ultimoPasso, 'tool.post')
})

// CARD-120c: sem poda, `this.sessoes` so cresce -- todo boot remonta o
// JSONL inteiro e nunca esquece uma sessao, que e como 160 sessoes
// historicas chegaram a `estado-publico/sessoes.json`.
test('podar tira do indice sessao sem evento ha mais de 24h, sem mexer na ativa', () => {
  const e = new Estado(dir())
  const agora = Date.now()
  e.registrar(ev({ session: 'de-ontem', ts: new Date(agora - 30 * 3600_000).toISOString() }))
  e.registrar(ev({ session: 'de-agora', ts: new Date(agora).toISOString() }))
  e.podar({ agora, maxIdadeMs: 24 * 3600_000 })
  assert.deepEqual(e.snapshot().sessoes.map((s) => s.id), ['de-agora'])
})

test('poda roda sozinha no boot, com o padrao de 24h', () => {
  const d = dir()
  const antigo = new Estado(d, { maxIdadeSessaoMs: 24 * 3600_000 })
  antigo.registrar(ev({ session: 'fantasma-de-30h', ts: new Date(Date.now() - 30 * 3600_000).toISOString() }))
  // Remontar do MESMO disco (outro processo, outro boot): a sessao de 30h
  // atras nao pode reaparecer so porque o JSONL a contem.
  const novo = new Estado(d, { maxIdadeSessaoMs: 24 * 3600_000 })
  assert.deepEqual(novo.snapshot().sessoes, [])
})

test('podar nao mexe em sessao dentro do prazo', () => {
  const e = new Estado(dir())
  e.registrar(ev({ session: 'recente', ts: new Date(Date.now() - 60_000).toISOString() }))
  e.podar({ maxIdadeMs: 24 * 3600_000 })
  assert.equal(e.snapshot().sessoes.length, 1)
})
