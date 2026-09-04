import { test } from 'node:test'
import assert from 'node:assert/strict'
import { calcularMetricas } from '../src/metricas.js'

const ev = (o) => ({ ts: o.ts ?? '2026-09-04T10:00:00.000Z', kind: 'tool.post', loop: 'L1',
  card: null, agent: null, session: 's1', parent_agent: null, payload: {}, ...o })

test('turnos por card sai dos fins de turno, agrupados', () => {
  const m = calcularMetricas([
    ev({ kind: 'turn.stop', card: 'CARD-1' }),
    ev({ kind: 'turn.stop', card: 'CARD-1' }),
    ev({ kind: 'turn.stop', card: 'CARD-2' }),
  ])
  assert.equal(m.turnosPorCard.valor['CARD-1'], 2)
  assert.equal(m.turnosPorCard.valor['CARD-2'], 1)
})

test('reprovacoes por gate mostram qual verificacao pega de verdade', () => {
  const m = calcularMetricas([
    ev({ kind: 'gate.decidido', payload: { gate: 'GV2', decisao: 'reprovou' } }),
    ev({ kind: 'gate.decidido', payload: { gate: 'GV2', decisao: 'reprovou' } }),
    ev({ kind: 'gate.decidido', payload: { gate: 'GV2', decisao: 'passou' } }),
    ev({ kind: 'gate.decidido', payload: { gate: 'G1', decisao: 'passou' } }),
  ])
  assert.deepEqual(m.reprovacoesPorGate.valor.GV2, { reprovou: 2, passou: 1 })
})

test('gate que nunca reprovou e sinalizado: ou esta quebrado ou e decoracao', () => {
  const m = calcularMetricas([
    ev({ kind: 'gate.decidido', payload: { gate: 'G1', decisao: 'passou' } }),
    ev({ kind: 'gate.decidido', payload: { gate: 'G1', decisao: 'passou' } }),
    ev({ kind: 'gate.decidido', payload: { gate: 'GV2', decisao: 'reprovou' } }),
  ])
  assert.deepEqual(m.gatesQueNuncaReprovam.valor, ['G1'])
})

test('custo por card soma a telemetria, e nao inventa', () => {
  const m = calcularMetricas([
    ev({ kind: 'custo', card: 'CARD-1', payload: { usd: 1.5 } }),
    ev({ kind: 'custo', card: 'CARD-1', payload: { usd: 2.25 } }),
  ])
  assert.equal(m.custoPorCard.valor['CARD-1'], 3.75)
})

test('sem telemetria de custo o painel diz que esta esperando, e nao zero', () => {
  const m = calcularMetricas([ev({ kind: 'turn.stop', card: 'CARD-1' })])
  assert.equal(m.custoPorCard.valor, null)
  assert.match(m.custoPorCard.estado, /aguardando/i)
})

test('taxa de escalonamento e a fracao de gates que pararam para humano', () => {
  const m = calcularMetricas([
    ev({ kind: 'gate.decidido', payload: { gate: 'G1', decisao: 'aguardando_humano' } }),
    ev({ kind: 'gate.decidido', payload: { gate: 'GV2', decisao: 'passou' } }),
    ev({ kind: 'gate.decidido', payload: { gate: 'GV2', decisao: 'passou' } }),
    ev({ kind: 'gate.decidido', payload: { gate: 'GV2', decisao: 'reprovou' } }),
  ])
  assert.equal(m.taxaDeEscalonamento.valor, 0.25)
})

test('tempo de review humano mede da espera ate a decisao', () => {
  const m = calcularMetricas([
    ev({ ts: '2026-09-04T10:00:00.000Z', kind: 'gate.decidido',
      payload: { gate: 'G1', card: 'CARD-1', decisao: 'aguardando_humano' } }),
    ev({ ts: '2026-09-04T10:12:00.000Z', kind: 'gate.decidido',
      payload: { gate: 'G1', card: 'CARD-1', decisao: 'passou', por: 'humano' } }),
  ])
  assert.equal(m.tempoDeReviewHumano.valor, 12 * 60000)
})

test('metrica que depende de dado que o console nao tem diz isso em voz alta', () => {
  const m = calcularMetricas([])
  assert.equal(m.coberturaDeMutacao.valor, null)
  assert.match(m.coberturaDeMutacao.estado, /fora do console/i)
  assert.equal(m.changeFailureRate.valor, null)
  assert.match(m.changeFailureRate.estado, /produção|producao/i)
})

test('lista vazia nao estoura e devolve todas as metricas em estado explicito', () => {
  const m = calcularMetricas([])
  for (const [nome, v] of Object.entries(m)) {
    assert.ok('valor' in v && 'estado' in v, `${nome} precisa dizer valor e estado`)
  }
})

// ── métricas do trabalho real ───────────────────────────────────────────────
// As do método (gates, cards) dependem do SLE estar em uso. Estas medem o que
// já está acontecendo: sem elas a tela fica vazia com mil eventos capturados.

const tool = (o) => ev({ kind: 'tool.post', ...o,
  payload: { tool: o.tool ?? 'Edit', ok: o.ok ?? true, ms: o.ms ?? 100, cwd: o.cwd, ...(o.payload ?? {}) } })

test('atividade por projeto sai do cwd de cada evento', () => {
  const m = calcularMetricas([
    tool({ session: 's1', cwd: '/dev/projeto-a' }),
    tool({ session: 's1', cwd: '/dev/projeto-a' }),
    tool({ session: 's2', cwd: '/dev/projeto-b' }),
  ])
  assert.equal(m.atividadePorProjeto.valor['projeto-a'], 2)
  assert.equal(m.atividadePorProjeto.valor['projeto-b'], 1)
})

test('as ferramentas mais usadas dizem o que os agentes de fato fazem', () => {
  const m = calcularMetricas([
    tool({ session: 's1', tool: 'Bash' }), tool({ session: 's1', tool: 'Bash' }),
    tool({ session: 's1', tool: 'Edit' }),
  ])
  assert.equal(m.ferramentasMaisUsadas.valor.Bash, 2)
  assert.equal(m.ferramentasMaisUsadas.valor.Edit, 1)
})

test('taxa de falha de comando: a fracao que voltou errada', () => {
  const m = calcularMetricas([
    tool({ session: 's1', ok: false }), tool({ session: 's1', ok: true }),
    tool({ session: 's1', ok: true }), tool({ session: 's1', ok: true }),
  ])
  assert.equal(m.taxaDeFalhaDeComando.valor, 0.25)
})

test('pico de sessoes simultaneas: quantos agentes trabalharam junto', () => {
  const m = calcularMetricas([
    tool({ session: 'a', ts: '2026-09-04T10:00:00.000Z' }),
    tool({ session: 'b', ts: '2026-09-04T10:01:00.000Z' }),
    tool({ session: 'c', ts: '2026-09-04T10:02:00.000Z' }),
    tool({ session: 'a', ts: '2026-09-04T18:00:00.000Z' }),
  ])
  assert.equal(m.picoDeSessoesSimultaneas.valor, 3, 'tres sessoes na mesma janela')
})

test('sem eventos, as metricas de atividade tambem dizem o motivo', () => {
  const m = calcularMetricas([])
  assert.equal(m.atividadePorProjeto.valor, null)
  assert.match(m.atividadePorProjeto.estado, /nenhum/i)
})
