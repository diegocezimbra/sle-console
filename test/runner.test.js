import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Runner } from '../src/runner.js'

function projeto(agentes = {}) {
  const d = mkdtempSync(join(tmpdir(), 'sle-run-'))
  mkdirSync(join(d, 'sle', 'agents'), { recursive: true })
  const padrao = {
    implementer: {
      id: 'implementer', role: 'maker', comando: 'echo trabalhando', stages: ['E4'],
      provider: 'anthropic', model: 'claude-sonnet-5',
      limits: { max_minutes: 1, max_usd: 6 },
    },
  }
  for (const [id, a] of Object.entries({ ...padrao, ...agentes })) {
    writeFileSync(join(d, 'sle', 'agents', `${id}.json`), JSON.stringify(a))
  }
  return d
}

test('so roda agente que existe na configuracao', async () => {
  const r = new Runner(projeto())
  const bom = await r.iniciar('implementer')
  assert.equal(bom.ok, true)
  const mau = await r.iniciar('agente-inventado')
  assert.equal(mau.ok, false)
  assert.match(mau.erro, /nao existe/i)
  await r.pararTudo()
})

test('o comando vem da configuracao, nunca da requisicao', async () => {
  const r = new Runner(projeto())
  // Mesmo pedindo, nao ha como injetar comando: a API so aceita o id do agente.
  const saida = await r.iniciar('implementer', { comando: 'rm -rf /' })
  assert.equal(saida.ok, true)
  const processo = r.ativos()[0] ?? (await esperarFim(r))
  assert.doesNotMatch(processo.comando, /rm -rf/)
  await r.pararTudo()
})

test('o agente aparece como ativo enquanto roda e some quando termina', async () => {
  const r = new Runner(projeto({ demorado: { id: 'demorado', comando: 'sleep 5', role: 'maker' } }))
  await r.iniciar('demorado')
  assert.equal(r.ativos().length, 1)
  assert.equal(r.ativos()[0].agente, 'demorado')
  await r.pararTudo()
  assert.equal(r.ativos().length, 0)
})

test('a parada de emergencia mata todo mundo', async () => {
  const r = new Runner(projeto({
    a: { id: 'a', comando: 'sleep 5', role: 'maker' },
    b: { id: 'b', comando: 'sleep 5', role: 'maker' },
  }))
  await r.iniciar('a')
  await r.iniciar('b')
  assert.equal(r.ativos().length, 2)
  const mortos = await r.pararTudo()
  assert.equal(mortos, 2)
  assert.equal(r.ativos().length, 0)
})

test('teto de gasto diario recusa novo agente antes de gastar mais', async () => {
  const r = new Runner(projeto(), { tetoDiarioUsd: 10 })
  r.registrarGasto(9.5)
  const negado = await r.iniciar('implementer')
  assert.equal(negado.ok, false)
  assert.match(negado.erro, /teto/i)
  assert.equal(r.ativos().length, 0)
})

test('o ambiente do processo carrega o provedor do agente, e nao o global', async () => {
  const r = new Runner(projeto({
    barato: { id: 'barato', comando: 'echo x', role: 'maker', provider: 'deepseek', model: 'deepseek-v4-pro' },
  }))
  const info = await r.iniciar('barato')
  assert.equal(info.ok, true)
  assert.equal(info.processo.env.ANTHROPIC_MODEL, 'deepseek-v4-pro')
  await r.pararTudo()
})

test('limite de minutos derruba o agente que nao termina', async () => {
  const r = new Runner(projeto({
    infinito: { id: 'infinito', comando: 'sleep 30', role: 'maker', limits: { max_minutes: 0.01 } },
  }))
  await r.iniciar('infinito')
  await new Promise((res) => setTimeout(res, 1200))
  assert.equal(r.ativos().length, 0, 'agente que passa do limite precisa morrer sozinho')
  await r.pararTudo()
})

function esperarFim(r) {
  return new Promise((ok) => setTimeout(() => ok(r.historico().at(-1)), 300))
}
