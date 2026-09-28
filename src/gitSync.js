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
 * Retries the sync as `git pull --rebase`, for when a plain push came back
 * rejected (someone else -- the Diego's local `deus` -- pushed first). If
 * the rebase itself conflicts, it's aborted immediately: the local commit
 * (the Diego's answer) must never be left half-merged or lost, so we'd
 * rather leave it pending for the next round than risk the tree stuck
 * mid-conflict with nobody there to resolve it.
 */
export function pullRebase({ dataDir, keyPath }) {
  const env = sshEnv(keyPath)
  const rebase = run(['pull', '--rebase'], { cwd: dataDir, env })
  if (!rebase.ok) {
    run(['rebase', '--abort'], { cwd: dataDir })
    return { ...rebase, conflito: true }
  }
  return rebase
}

/**
 * Pushes whatever is already committed locally (e.g. a previous
 * `commitAndPush` whose `git push` failed -- network down, deploy key
 * without write access, GitHub unreachable). Called from the pull loop so a
 * card the Diego already answered eventually reaches GitHub without him
 * resubmitting anything. `ok: true` with nothing to do ("Everything
 * up-to-date") is indistinguishable from a real push here on purpose --
 * the caller doesn't need to know the difference.
 */
export function pushPendente({ dataDir, keyPath }) {
  const env = sshEnv(keyPath)
  let push = run(['push'], { cwd: dataDir, env })
  if (push.ok) return push
  if (/rejected|non-fast-forward/i.test(push.stderr)) {
    const rebase = pullRebase({ dataDir, keyPath })
    if (!rebase.ok) return rebase
    push = run(['push'], { cwd: dataDir, env })
  }
  return push
}

/**
 * Starts pulling every `intervalMs` (default 60s per CARD-096). Before each
 * pull it retries any push left pending from an earlier failed
 * `commitAndPush` (`onPushResult`) -- a card answered while GitHub was
 * unreachable eventually reaches it without the Diego resubmitting
 * anything. Returns a `stop()` to clear the timer -- without it, tests (and
 * graceful shutdown) would hang on a dangling interval.
 */
export function startPullLoop({ dataDir, keyPath, intervalMs = 60_000, onResult, onPushResult }) {
  const timer = setInterval(() => {
    const empurrado = pushPendente({ dataDir, keyPath })
    onPushResult?.(empurrado)

    const result = pull({ dataDir, keyPath })
    onResult?.(result)
  }, intervalMs)
  timer.unref?.()
  return { stop: () => clearInterval(timer) }
}

/**
 * Commits `paths` (relative to `dataDir`) and pushes. On a non-fast-forward
 * push rejection, retries once with `pull --rebase` -- the two writers this
 * needs to survive are the cloud console and the Diego's local `deus`. A
 * push that still fails after that (deploy key read-only, GitHub down, DNS
 * broken) is returned as-is with `ok: false` and the git `stderr` intact --
 * the commit stays local, ready for `pushPendente` to retry on the next
 * pull tick; the caller decides what to tell the HTTP client (never fake a
 * 200 that hides an unsynced commit).
 */
export function commitAndPush({ dataDir, keyPath, paths, message }) {
  // `-A` (not a plain `add <path>`) so a card MOVED between column folders
  // stages both the deletion at the old path and the creation at the new
  // one -- without it, a rename leaves the old path dangling in the index.
  const add = run(['add', '-A', '--', ...paths], { cwd: dataDir })
  if (!add.ok) return add

  const commit = run(['commit', '-m', message], { cwd: dataDir })
  // "nothing to commit" is not a failure: the card may already match.
  if (!commit.ok && !/nothing to commit/i.test(commit.stdout)) return commit

  return pushPendente({ dataDir, keyPath })
}
