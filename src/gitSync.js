/**
 * Git mode (`CONSOLE_MODE=git`): the console's data tree is a clone of a
 * remote repo, kept in sync by pull on an interval and by push when the
 * Diego answers or resolves a card. No dependency, only `git` on PATH.
 *
 * Kept deliberately dumb: whoever calls this decides *when* to sync and
 * *what* to commit. This module only knows how to run the git commands
 * safely (deploy key isolated via `GIT_SSH_COMMAND`, no shell interpolation).
 */
import { spawnSync } from 'node:child_process'
import { existsSync, chmodSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

/**
 * Writes the deploy key to `keyPath` with 0600 permissions, as required by
 * ssh -- a key readable by group/others is refused silently by some ssh
 * builds and, worse, is a leak waiting to happen in a shared container.
 */
export function writeDeployKey(keyPath, keyContents) {
  mkdirSync(dirname(keyPath), { recursive: true })
  writeFileSync(keyPath, keyContents.endsWith('\n') ? keyContents : `${keyContents}\n`, { mode: 0o600 })
  chmodSync(keyPath, 0o600)
}

function run(args, { cwd, env } = {}) {
  const result = spawnSync('git', args, { cwd, env, encoding: 'utf8' })
  return {
    ok: result.status === 0,
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  }
}

/**
 * `sshCommand` disables host-key prompts (`StrictHostKeyChecking=accept-new`)
 * so the first clone in a fresh container doesn't hang waiting for a `yes`
 * nobody is there to type.
 */
function sshEnv(keyPath) {
  return {
    ...process.env,
    GIT_SSH_COMMAND: `ssh -i ${keyPath} -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new`,
  }
}

/**
 * Clones `repoUrl` into `dataDir` if it isn't there yet, otherwise does
 * nothing -- so it is safe to call on every daemon start.
 */
export function ensureCloned({ repoUrl, dataDir, keyPath, branch = 'main' }) {
  if (existsSync(`${dataDir}/.git`)) return { ok: true, cloned: false }
  mkdirSync(dirname(dataDir), { recursive: true })
  const result = run(['clone', '--branch', branch, '--single-branch', repoUrl, dataDir], {
    env: sshEnv(keyPath),
  })
  return { ...result, cloned: result.ok }
}

/** `--ff-only`: a fast-forward that fails means local diverged -- surface it, never merge silently. */
export function pull({ dataDir, keyPath }) {
  return run(['pull', '--ff-only'], { cwd: dataDir, env: sshEnv(keyPath) })
}

/**
 * Starts pulling every `intervalMs` (default 60s per CARD-096). Returns a
 * `stop()` to clear the timer -- without it, tests (and graceful shutdown)
 * would hang on a dangling interval.
 */
export function startPullLoop({ dataDir, keyPath, intervalMs = 60_000, onResult }) {
  const timer = setInterval(() => {
    const result = pull({ dataDir, keyPath })
    onResult?.(result)
  }, intervalMs)
  timer.unref?.()
  return { stop: () => clearInterval(timer) }
}

/**
 * Commits `paths` (relative to `dataDir`) and pushes. On a non-fast-forward
 * push rejection, retries once with `pull --rebase` -- the two writers this
 * needs to survive are the cloud console and the Diego's local `deus`.
 */
export function commitAndPush({ dataDir, keyPath, paths, message }) {
  const env = sshEnv(keyPath)
  const add = run(['add', ...paths], { cwd: dataDir })
  if (!add.ok) return add

  const commit = run(['commit', '-m', message], { cwd: dataDir })
  // "nothing to commit" is not a failure: the card may already match.
  if (!commit.ok && !/nothing to commit/i.test(commit.stdout)) return commit

  let push = run(['push'], { cwd: dataDir, env })
  if (!push.ok && /rejected|non-fast-forward/i.test(push.stderr)) {
    const rebase = run(['pull', '--rebase'], { cwd: dataDir, env })
    if (!rebase.ok) return rebase
    push = run(['push'], { cwd: dataDir, env })
  }
  return push
}
