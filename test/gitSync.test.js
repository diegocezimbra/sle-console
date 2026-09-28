import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import {
  writeDeployKey,
  ensureCloned,
  ensureIdentidade,
  pull,
  pullRebase,
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

test('ensureIdentidade preenche user.name/user.email quando faltam, e commit funciona sem "Please tell me who you are"', () => {
  const remoto = criarRemoto()
  const dataDir = join(mkdtempSync(join(tmpdir(), 'sle-data-')), '00-deus')
  ensureCloned({ repoUrl: remoto, dataDir, keyPath: '/dev/null', branch: 'main' })
  // clone novo, sem identidade -- é assim que o container de produção chegou
  // a ficar: git commit falhava com "Please tell me who you are" e o push
  // ficava calado, mesmo com a chave de deploy funcionando.

  ensureIdentidade({ dataDir })

  writeFileSync(join(dataDir, 'cards', 'CARD-001.md'), '# CARD-001\nresposta\n')
  const commit = spawnSync('git', ['commit', '-am', 'resposta'], { cwd: dataDir, encoding: 'utf8' })
  assert.equal(commit.status, 0, commit.stderr)
  assert.doesNotMatch(commit.stderr ?? '', /Please tell me who you are/)
})

test('ensureIdentidade nao sobrescreve identidade ja configurada', () => {
  const remoto = criarRemoto()
  const dataDir = join(mkdtempSync(join(tmpdir(), 'sle-data-')), '00-deus')
  ensureCloned({ repoUrl: remoto, dataDir, keyPath: '/dev/null', branch: 'main' })
  spawnSync('git', ['config', 'user.name', 'diego local'], { cwd: dataDir })
  spawnSync('git', ['config', 'user.email', 'diego@ohanax.com'], { cwd: dataDir })

  ensureIdentidade({ dataDir })

  const nome = spawnSync('git', ['config', 'user.name'], { cwd: dataDir, encoding: 'utf8' }).stdout.trim()
  const email = spawnSync('git', ['config', 'user.email'], { cwd: dataDir, encoding: 'utf8' }).stdout.trim()
  assert.equal(nome, 'diego local')
  assert.equal(email, 'diego@ohanax.com')
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

test('commitAndPush com push que falha devolve stderr legivel do git (chave invalida)', () => {
  const remoto = criarRemoto()
  const dataDir = join(mkdtempSync(join(tmpdir(), 'sle-data-')), '00-deus')
  ensureCloned({ repoUrl: remoto, dataDir, keyPath: '/dev/null', branch: 'main' })
  git(['config', 'user.email', 'console@example.com'], dataDir)
  git(['config', 'user.name', 'console'], dataDir)
  // remote inexistente -- simula push que falha (deploy key sem permissao, host fora do ar etc)
  git(['remote', 'set-url', 'origin', join(tmpdir(), 'sle-remoto-inexistente-xyz')], dataDir)

  writeFileSync(join(dataDir, 'cards', 'CARD-001.md'), '# CARD-001\nresposta do Diego\n')
  const r = commitAndPush({
    dataDir,
    keyPath: '/dev/null',
    paths: ['cards/CARD-001.md'],
    message: 'resposta do Diego: CARD-001',
  })
  assert.equal(r.ok, false)
  assert.ok(r.stderr && r.stderr.length > 0, 'stderr do git deve vir preenchido e legivel')

  // o commit local aconteceu mesmo com o push falho -- nada se perde no disco
  const log = spawnSync('git', ['log', '-1', '--format=%s'], { cwd: dataDir, encoding: 'utf8' }).stdout
  assert.match(log, /resposta do Diego: CARD-001/)
})

test('pullRebase reenvia pull --rebase e, em conflito, aborta sem perder o commit local', () => {
  const remoto = criarRemoto()
  const dataDir = join(mkdtempSync(join(tmpdir(), 'sle-data-')), '00-deus')
  ensureCloned({ repoUrl: remoto, dataDir, keyPath: '/dev/null', branch: 'main' })
  git(['config', 'user.email', 'console@example.com'], dataDir)
  git(['config', 'user.name', 'console'], dataDir)

  // outro escritor (o Diego local) empurra uma mudanca conflitante na mesma linha
  const outro = mkdtempSync(join(tmpdir(), 'sle-outro-'))
  git(['clone', remoto, outro])
  git(['config', 'user.email', 'x@example.com'], outro)
  git(['config', 'user.name', 'x'], outro)
  writeFileSync(join(outro, 'cards', 'CARD-001.md'), '# CARD-001\ndo diego local\n')
  git(['add', 'cards/CARD-001.md'], outro)
  git(['commit', '-m', 'do diego local'], outro)
  git(['push'], outro)

  // commit local pendente, conflitante com o que acabou de subir
  writeFileSync(join(dataDir, 'cards', 'CARD-001.md'), '# CARD-001\nda nuvem\n')
  git(['add', 'cards/CARD-001.md'], dataDir)
  git(['commit', '-m', 'da nuvem'], dataDir)

  const antes = spawnSync('git', ['log', '-1', '--format=%H'], { cwd: dataDir, encoding: 'utf8' }).stdout.trim()

  const r = pullRebase({ dataDir, keyPath: '/dev/null' })
  assert.equal(r.ok, false)
  assert.equal(r.conflito, true)

  // o rebase foi abortado -- sem rebase em andamento e sem perder o commit local
  const status = spawnSync('git', ['status', '--porcelain=v2'], { cwd: dataDir, encoding: 'utf8' }).stdout
  assert.doesNotMatch(status, /rebase/)
  const depois = spawnSync('git', ['log', '-1', '--format=%H'], { cwd: dataDir, encoding: 'utf8' }).stdout.trim()
  assert.equal(depois, antes, 'commit local pendente precisa continuar no HEAD apos o abort')
})

test('startPullLoop empurra o push pendente ANTES de cada pull do intervalo', async () => {
  const remoto = criarRemoto()
  const dataDir = join(mkdtempSync(join(tmpdir(), 'sle-data-')), '00-deus')
  ensureCloned({ repoUrl: remoto, dataDir, keyPath: '/dev/null', branch: 'main' })
  git(['config', 'user.email', 'console@example.com'], dataDir)
  git(['config', 'user.name', 'console'], dataDir)

  // commit local que ainda nao foi empurrado (simula push original que falhou calado)
  writeFileSync(join(dataDir, 'cards', 'CARD-001.md'), '# CARD-001\npendente de push\n')
  git(['add', 'cards/CARD-001.md'], dataDir)
  git(['commit', '-m', 'pendente de push'], dataDir)

  let chamadasPush = 0
  const loop = startPullLoop({
    dataDir,
    keyPath: '/dev/null',
    intervalMs: 20,
    onPushResult: (r) => {
      chamadasPush++
      assert.equal(r.ok, true)
    },
  })
  await new Promise((r) => setTimeout(r, 60))
  loop.stop()
  assert.ok(chamadasPush >= 1)

  const verificacao = mkdtempSync(join(tmpdir(), 'sle-verifica-'))
  git(['clone', remoto, verificacao])
  assert.equal(
    readFileSync(join(verificacao, 'cards', 'CARD-001.md'), 'utf8'),
    '# CARD-001\npendente de push\n'
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
