import { test } from 'node:test'
import assert from 'node:assert/strict'

import { createConcurrencyLimiter, runCommand } from '../src/run-command.js'

test('espera close: o filho terminou e foi recolhido, sem zumbi', async () => {
  let exits = 0

  const result = await runCommand(process.execPath, ['-e', 'process.exit(0)'], {
    onSpawn: (child) => {
      child.once('exit', () => { exits++ })
    },
  })

  assert.equal(result.ok, true)
  assert.equal(exits, 1, 'o evento exit confirma que Node recolheu o filho')
})

test('mata e recolhe o filho que excede o timeout', async () => {
  let exits = 0
  const result = await runCommand(process.execPath, ['-e', 'setInterval(() => {}, 1_000)'], {
    timeoutMs: 100,
    onSpawn: (child) => { child.once('exit', () => { exits++ }) },
  })

  assert.equal(result.timedOut, true)
  assert.equal(result.ok, false)
  assert.equal(exits, 1, 'o filho morto pelo timeout também foi recolhido')
})

test('limitador deixa no máximo dois disparos periódicos simultâneos', async () => {
  const limit = createConcurrencyLimiter(2)
  let active = 0
  let peak = 0
  const tasks = Array.from({ length: 6 }, () => limit(async () => {
    active++
    peak = Math.max(peak, active)
    await new Promise((resolve) => setTimeout(resolve, 25))
    active--
  }))

  await Promise.all(tasks)
  assert.equal(peak, 2)
})
