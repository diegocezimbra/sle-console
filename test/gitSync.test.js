import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import {
  writeDeployKey,
  ensureCloned,
  pull,
  startPullLoop,
  commitAndPush,
} from '../src/gitSync.js'

function git(args, cwd) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' })
  assert.equal(r.status, 0, r.stderr)
  return r.stdout
}

/** A bare repo on disk stands in for GitHub -- `file://` needs no SSH key. */
function criarRemoto() {
  const remoto = mkdtempSync(join(tmpdir(), 'sle-remote-'))
  git(['init', '--bare', '-b', 'main', remoto])

  const seed = mkdtempSync(join(tmpdir(), 'sle-seed-'))
  git(['init', '-b', 'main', seed])
  git(['config', 'user.email', 'seed@example.com'], seed)
  git(['config', 'user.name', 'seed'], seed)
  mkdirSync(join(seed, 'cards'))
  writeFileSync(join(seed, 'cards', 'CARD-001.md'), '# CARD-001\n')
  git(['add', 'cards/CARD-001.md'], seed)
  git(['commit', '-m', 'seed'], seed)
  git(['remote', 'add', 'origin', remoto], seed)
  git(['push', 'origin', 'main'], seed)
  return remoto
}

test('writeDeployKey grava a chave com permissao 0600', () => {
  const base = mkdtempSync(join(tmpdir(), 'sle-key-'))
  const keyPath = join(base, 'sub', 'deploy_key')
  writeDeployKey(keyPath, 'chave-fake')
  const conteudo = readFileSync(keyPath, 'utf8')
  assert.equal(conteudo, 'chave-fake\n')
  const modo = statSync(keyPath).mode & 0o777
  assert.equal(modo, 0o600)
})

test('ensureCloned clona de um remoto local e é idempotente', () => {
  const remoto = criarRemoto()
  const dataDir = join(mkdtempSync(join(tmpdir(), 'sle-data-')), '00-deus')
  const keyPath = '/dev/null'

  const primeiro = ensureCloned({ repoUrl: remoto, dataDir, keyPath, branch: 'main' })
  assert.equal(primeiro.ok, true)
  assert.equal(primeiro.cloned, true)
  assert.equal(readFileSync(join(dataDir, 'cards', 'CARD-001.md'), 'utf8'), '# CARD-001\n')

  const segundo = ensureCloned({ repoUrl: remoto, dataDir, keyPath, branch: 'main' })
  assert.equal(segundo.cloned, false)
})

test('pull traz um commit novo do remoto', () => {
  const remoto = criarRemoto()
  const dataDir = join(mkdtempSync(join(tmpdir(), 'sle-data-')), '00-deus')
  ensureCloned({ repoUrl: remoto, dataDir, keyPath: '/dev/null', branch: 'main' })

  // Outro clone simula o Diego local empurrando uma resposta.
  const outro = mkdtempSync(join(tmpdir(), 'sle-outro-'))
  git(['clone', remoto, outro])
  git(['config', 'user.email', 'x@example.com'], outro)
  git(['config', 'user.name', 'x'], outro)
  writeFileSync(join(outro, 'cards', 'CARD-001.md'), '# CARD-001\nresposta\n')
  git(['add', 'cards/CARD-001.md'], outro)
  git(['commit', '-m', 'resposta'], outro)
  git(['push'], outro)

  const r = pull({ dataDir, keyPath: '/dev/null' })
  assert.equal(r.ok, true)
  assert.equal(readFileSync(join(dataDir, 'cards', 'CARD-001.md'), 'utf8'), '# CARD-001\nresposta\n')
})

test('commitAndPush publica uma edicao local no remoto', () => {
  const remoto = criarRemoto()
  const dataDir = join(mkdtempSync(join(tmpdir(), 'sle-data-')), '00-deus')
  ensureCloned({ repoUrl: remoto, dataDir, keyPath: '/dev/null', branch: 'main' })
  git(['config', 'user.email', 'console@example.com'], dataDir)
  git(['config', 'user.name', 'console'], dataDir)

  writeFileSync(join(dataDir, 'cards', 'CARD-001.md'), '# CARD-001\nresposta do Diego\n')
  const r = commitAndPush({
    dataDir,
    keyPath: '/dev/null',
    paths: ['cards/CARD-001.md'],
    message: 'resposta do Diego: CARD-001',
  })
  assert.equal(r.ok, true)

  const verificacao = mkdtempSync(join(tmpdir(), 'sle-verifica-'))
  git(['clone', remoto, verificacao])
  assert.equal(
    readFileSync(join(verificacao, 'cards', 'CARD-001.md'), 'utf8'),
    '# CARD-001\nresposta do Diego\n'
  )
})

test('startPullLoop chama pull no intervalo e stop() cancela', async () => {
  const remoto = criarRemoto()
  const dataDir = join(mkdtempSync(join(tmpdir(), 'sle-data-')), '00-deus')
  ensureCloned({ repoUrl: remoto, dataDir, keyPath: '/dev/null', branch: 'main' })

  let chamadas = 0
  const loop = startPullLoop({
    dataDir,
    keyPath: '/dev/null',
    intervalMs: 20,
    onResult: () => chamadas++,
  })
  await new Promise((r) => setTimeout(r, 70))
  loop.stop()
  const apos = chamadas
  await new Promise((r) => setTimeout(r, 60))
  assert.ok(chamadas >= 2)
  assert.equal(chamadas, apos)
})
