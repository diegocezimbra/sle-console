import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createConcurrencyLimiter, runCommand, runPeriodicCommand } from '../src/run-command.js'

test('timeout mata o grupo: o neto não sobrevive ao shell', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'sle-run-command-'))
  const pidFile = join(dir, 'neto.pid')
  const result = await runCommand('/bin/sh', ['-c', `sleep 30 & echo $! > "${pidFile}"; wait`], {
    timeoutMs: 250,
  })

  assert.equal(result.timedOut, true)
  assert.equal(result.ok, false)
  assert.equal(existsSync(pidFile), true)
  const pid = Number(readFileSync(pidFile, 'utf8').trim())
  // `ps` não listar o PID prova o efeito no neto; contar `exit` só provaria
  // que o Node recolheu o filho direto.
  const ps = await runCommand('ps', ['-p', String(pid), '-o', 'pid='], { timeoutMs: 1_000 })
  assert.equal(ps.stdout.trim(), '', `o neto ${pid} não pode sobreviver ao timeout`)
})

test('limite de saída e ENOENT viram resultados limpos', async () => {
  const cheio = await runCommand('/bin/sh', ['-c', 'yes x | head -c 10000'], { maxBuffer: 512 })
  assert.equal(cheio.ok, false)
  assert.equal(cheio.overflowed, true)
  assert.ok(Buffer.byteLength(cheio.stdout) <= 512)

  const ausente = await runCommand('comando-que-nao-existe-sle', [])
  assert.equal(ausente.ok, false)
  assert.match(ausente.error, /ENOENT/)
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

test('runPeriodicCommand aplica o limite real da fila misc', async () => {
  let ativos = 0
  let pico = 0
  const tarefas = Array.from({ length: 5 }, () => runPeriodicCommand(process.execPath, ['-e', 'setTimeout(() => {}, 80)'], {
    queue: 'misc',
    onSpawn: (child) => {
      ativos++
      pico = Math.max(pico, ativos)
      child.once('close', () => { ativos-- })
    },
  }))
  await Promise.all(tarefas)
  assert.equal(pico, 2)
})
