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

// Varreduras de git podem formar uma fila longa (uma por repositório). Elas
// nunca devem ocupar as vagas do publish do censo, que é uma operação serial.
const periodicQueues = {
  gitScan: createConcurrencyLimiter(4),
  publish: createConcurrencyLimiter(1),
  misc: createConcurrencyLimiter(2),
}

export function runCommand(command, args, {
  cwd,
  env,
  timeoutMs = COMMAND_TIMEOUT_MS,
  maxBuffer = COMMAND_MAX_BUFFER,
  input,
  binaryOutput = false,
  onSpawn,
} = {}) {
  return new Promise((resolve) => {
    let child
    let stdout = binaryOutput ? Buffer.alloc(0) : ''
    let stderr = ''
    let timedOut = false
    let overflowed = false
    let spawnError = null
    let settled = false
    let killTimer = null
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
    const appendBuffer = (current, chunk) => {
      const remaining = maxBuffer - current.length
      if (remaining <= 0) {
        overflowed = true
        return current
      }
      if (chunk.length > remaining) {
        overflowed = true
        return Buffer.concat([current, chunk.subarray(0, remaining)])
      }
      return Buffer.concat([current, chunk])
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

    const killGroup = (signal) => {
      if (!child?.pid) return
      try {
        // `detached` faz do filho líder de um grupo próprio; assim git/deus e
        // seus netos não ficam vivos quando o processo direto sai primeiro.
        process.kill(-child.pid, signal)
      } catch {
        try { child.kill(signal) } catch { /* o filho já saiu */ }
      }
    }
    const terminate = (graceful) => {
      if (graceful) {
        killGroup('SIGTERM')
        // Não cancelar ao receber `close`: o shell pode fechar antes de um
        // neto teimoso. O segundo sinal ainda alcança o mesmo grupo.
        killTimer = setTimeout(() => killGroup('SIGKILL'), 2_000)
        killTimer.unref?.()
      } else {
        killGroup('SIGKILL')
      }
    }
    const timer = setTimeout(() => {
      timedOut = true
      terminate(true)
    }, timeoutMs)
    timer.unref?.()

    try {
      child = spawn(command, args, {
        cwd,
        env,
        shell: false,
        detached: true,
        stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
      })
      if (input !== undefined) child.stdin.end(input)
      onSpawn?.(child)
      child.stdout.on('data', (chunk) => {
        stdout = binaryOutput ? appendBuffer(stdout, chunk) : append(stdout, chunk)
        if (overflowed) terminate(false)
      })
      child.stderr.on('data', (chunk) => {
        stderr = append(stderr, chunk)
        if (overflowed) terminate(false)
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

/** Comandos de timers têm filas independentes por finalidade. */
export function runPeriodicCommand(command, args, { queue = 'misc', ...options } = {}) {
  const limiter = periodicQueues[queue] ?? periodicQueues.misc
  return limiter(() => runCommand(command, args, options))
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
