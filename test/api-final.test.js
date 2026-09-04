import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { criarDaemon } from '../src/daemon.js'

let base, otlp, fechar, projeto

before(async () => {
  projeto = mkdtempSync(join(tmpdir(), 'sle-fim-'))
  for (const c of ['doing', 'review', 'done']) mkdirSync(join(projeto, 'cards', c), { recursive: true })
  mkdirSync(join(projeto, 'sle', 'gates'), { recursive: true })
  writeFileSync(join(projeto, 'cards', 'doing', 'CARD-1.md'),
    '---\nid: CARD-1\ntitle: Um\nstatus: doing\nrisk: baixo\n---\ncorpo\n')
  writeFileSync(join(projeto, 'sle', 'gates', 'pipeline.json'), JSON.stringify({
    gates: [{ id: 'GV2', name: 'Suite', after: 'V2', mode: 'auto',
      verify: { type: 'command', run: 'exit 1' } }] }))

  const d = criarDaemon({ dados: mkdtempSync(join(tmpdir(), 'sle-fimd-')), projeto })
  await new Promise((r) => d.servidor.listen(0, '127.0.0.1', r))
  await new Promise((r) => d.otlp.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${d.servidor.address().port}`
  otlp = `http://127.0.0.1:${d.otlp.address().port}`
  fechar = () => new Promise((r) => {
    d.observador.parar(); d.otlp.close()
    d.servidor.closeAllConnections(); d.servidor.close(r)
  })
})
after(async () => { await fechar?.() })

test('decidir um gate vira evento, e a metrica passa a enxergar', async () => {
  await fetch(`${base}/api/gates/GV2/decide`, {
    method: 'POST', body: JSON.stringify({ card: { id: 'CARD-1' } }) })
  const m = await (await fetch(`${base}/api/metrics`)).json()
  assert.deepEqual(m.reprovacoesPorGate.valor.GV2, { reprovou: 1 })
})

test('o receptor OTLP aceita custo e ele aparece por card', async () => {
  const r = await fetch(`${otlp}/v1/metrics`, {
    method: 'POST',
    body: JSON.stringify({ resourceMetrics: [{ scopeMetrics: [{ metrics: [{
      name: 'claude_code.cost.usage',
      sum: { dataPoints: [{ asDouble: 1.25, attributes: [
        { key: 'session.id', value: { stringValue: 's1' } }] }] } }] }] }] }),
  })
  assert.equal(r.status, 200, 'exportador OTel desiste se o receptor recusa')
  const m = await (await fetch(`${base}/api/metrics`)).json()
  assert.ok(m.custoPorCard.valor, 'o custo precisa ter sido contabilizado')
})

test('metrica sem dado diz o motivo, e nao devolve zero', async () => {
  const m = await (await fetch(`${base}/api/metrics`)).json()
  assert.equal(m.coberturaDeMutacao.valor, null)
  assert.match(m.coberturaDeMutacao.estado, /fora do console/i)
})

test('mover card muda a pasta e o status no arquivo', async () => {
  const r = await fetch(`${base}/api/cards/CARD-1/move`, {
    method: 'POST', body: JSON.stringify({ para: 'review' }) })
  assert.equal(r.status, 200)
  assert.equal(existsSync(join(projeto, 'cards/doing/CARD-1.md')), false)
  const novo = readFileSync(join(projeto, 'cards/review/CARD-1.md'), 'utf8')
  assert.match(novo, /^status: review$/m, 'a pasta e o frontmatter nao podem divergir')
  assert.match(novo, /^corpo$/m, 'o corpo do card precisa sobreviver a mudanca')
})

test('coluna inexistente nao cria pasta nova', async () => {
  const r = await fetch(`${base}/api/cards/CARD-1/move`, {
    method: 'POST', body: JSON.stringify({ para: 'inventada' }) })
  assert.equal(r.status, 422)
  assert.equal(existsSync(join(projeto, 'cards/inventada')), false)
})

test('mover card inexistente e 404', async () => {
  const r = await fetch(`${base}/api/cards/NAO-EXISTE/move`, {
    method: 'POST', body: JSON.stringify({ para: 'done' }) })
  assert.equal(r.status, 404)
})

test('o grafo de agentes vem no snapshot, pronto para desenhar', async () => {
  await fetch(`${base}/api/hook`, { method: 'POST', body: JSON.stringify({
    session_id: 'filho', hook_event_name: 'SubagentStart',
    agent_type: 'adversarial-reviewer', parent_agent: 'pai' }) })
  const s = await (await fetch(`${base}/api/snapshot`)).json()
  assert.deepEqual(s.grafo, [{ de: 'pai', para: 'filho', agente: 'adversarial-reviewer' }])
})
