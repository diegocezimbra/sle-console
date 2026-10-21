/**
 * Executor único dos comandos externos do console.
 *
 * Esperar por `close` é importante: `exit` só informa que o processo saiu;
 * `close` confirma que os pipes também fecharam e que o filho foi recolhido.
 */
import { spawn, spawnSync } from 'node:child_process'

export const COMMAND_TIMEOUT_MS = 15_000
export const COMMAND_MAX_BUFFER = 256 * 1024

export function createConcurrencyLimiter(limit = 2) {
  let active = 0
  const waiting = []

  const next = () => {
    if (active >= limit || waiting.length === 0) return
    active++
    const { task, resolve, reject } = waiting.shift()
    Promise.resolve()
      .then(task)
      .then(resolve, reject)
      .finally(() => {
        active--
        next()
      })
  }

  return (task) => new Promise((resolve, reject) => {
    waiting.push({ task, resolve, reject })
    next()
  })
}

const periodicQueue = createConcurrencyLimiter(2)

export function runCommand(command, args, {
  cwd,
  env,
  timeoutMs = COMMAND_TIMEOUT_MS,
  maxBuffer = COMMAND_MAX_BUFFER,
  onSpawn,
} = {}) {
  return new Promise((resolve) => {
    let child
    let stdout = ''
    let stderr = ''
    let timedOut = false
    let overflowed = false
    let spawnError = null
    let settled = false
    const startedAt = Date.now()
    const append = (current, chunk) => {
      const remaining = maxBuffer - Buffer.byteLength(current)
      if (remaining <= 0) {
        overflowed = true
        return current
      }
      const text = chunk.toString()
      if (Buffer.byteLength(text) > remaining) {
        overflowed = true
        return current + Buffer.from(text).subarray(0, remaining).toString()
      }
      return current + text
    }
    const finish = (code, signal) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({
        ok: !spawnError && !timedOut && !overflowed && code === 0,
        code,
        signal,
        stdout,
        stderr,
        timedOut,
        overflowed,
        error: spawnError?.message ?? null,
        ms: Date.now() - startedAt,
      })
    }

    const timer = setTimeout(() => {
      timedOut = true
      child?.kill('SIGKILL')
    }, timeoutMs)
    timer.unref?.()

    try {
      child = spawn(command, args, { cwd, env, shell: false, stdio: ['ignore', 'pipe', 'pipe'] })
      onSpawn?.(child)
      child.stdout.on('data', (chunk) => {
        stdout = append(stdout, chunk)
        if (overflowed) child.kill('SIGKILL')
      })
      child.stderr.on('data', (chunk) => {
        stderr = append(stderr, chunk)
        if (overflowed) child.kill('SIGKILL')
      })
      child.once('error', (error) => {
        spawnError = error
      })
      child.once('close', finish)
    } catch (error) {
      spawnError = error
      finish(null, null)
    }
  })
}

/** Comandos de timers: nunca mais de dois processos simultâneos. */
export function runPeriodicCommand(command, args, options) {
  return periodicQueue(() => runCommand(command, args, options))
}

/** Operações síncronas também usam os mesmos limites, sem poder travar para sempre. */
export function runCommandSync(command, args, {
  cwd,
  env,
  timeoutMs = COMMAND_TIMEOUT_MS,
  maxBuffer = COMMAND_MAX_BUFFER,
} = {}) {
  const result = spawnSync(command, args, {
    cwd,
    env,
    encoding: 'utf8',
    timeout: timeoutMs,
    maxBuffer,
    shell: false,
  })
  return {
    ok: result.status === 0,
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    error: result.error?.message ?? null,
  }
}
