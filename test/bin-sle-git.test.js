import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'

const AQUI = dirname(fileURLToPath(import.meta.url))
const BIN = join(AQUI, '..', 'bin', 'sle.js')

function git(args, cwd) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' })
  assert.equal(r.status, 0, r.stderr)
  return r.stdout
}

function criarRemoto() {
  const remoto = mkdtempSync(join(tmpdir(), 'sle-bin-remote-'))
  git(['init', '--bare', '-b', 'main', remoto])
  const seed = mkdtempSync(join(tmpdir(), 'sle-bin-seed-'))
  git(['init', '-b', 'main', seed])
  git(['config', 'user.email', 'seed@example.com'], seed)
  git(['config', 'user.name', 'seed'], seed)
  mkdirSync(join(seed, 'cards', 'backlog'), { recursive: true })
  writeFileSync(join(seed, 'cards', 'backlog', 'CARD-001.md'), '---\nid: CARD-001\nstatus: backlog\n---\n')
  git(['add', 'cards'], seed)
  git(['commit', '-m', 'seed'], seed)
  git(['remote', 'add', 'origin', remoto], seed)
  git(['push', 'origin', 'main'], seed)
  return remoto
}

async function esperarPorta(porta, tentativas = 100) {
  for (let i = 0; i < tentativas; i++) {
    try {
      await fetch(`http://127.0.0.1:${porta}/api/health`)
      return
    } catch {
      await new Promise((r) => setTimeout(r, 50))
    }
  }
  throw new Error('daemon nao subiu a tempo')
}

test('bin/sle.js em CONSOLE_MODE=git clona o remoto, grava a chave 0600, sobe em 0.0.0.0 e pede basic auth', async () => {
  const remoto = criarRemoto()
  const instalacao = mkdtempSync(join(tmpdir(), 'sle-bin-instalacao-'))
  const dataDir = join(instalacao, 'clone')
  const keyPath = join(instalacao, 'ssh', 'deploy_key')
  const porta = 20000 + Math.floor(Math.random() * 10000)

  const filho = spawn(process.execPath, [BIN], {
    env: {
      ...process.env,
      SLE_INSTALACAO: instalacao,
      SLE_PORT: String(porta),
      SLE_DATA: join(instalacao, 'dados'),
      CONSOLE_MODE: 'git',
      CONSOLE_GIT_REPO_URL: remoto,
      CONSOLE_GIT_BRANCH: 'main',
      CONSOLE_GIT_DATA_DIR: dataDir,
      CONSOLE_GIT_KEY_PATH: keyPath,
      CONSOLE_GIT_PULL_MS: '3600000',
      CONSOLE_GIT_DEPLOY_KEY: 'chave-fake-nao-usada-por-remoto-local',
      CONSOLE_USER: 'deus',
      CONSOLE_PASSWORD: 'segredo',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  try {
    await esperarPorta(porta)

    // Clonou o remoto e a raiz de projetos virou o clone.
    assert.equal(
      readFileSync(join(dataDir, 'cards', 'backlog', 'CARD-001.md'), 'utf8').includes('CARD-001'),
      true
    )
    // Chave gravada com 0600 -- nunca legivel por outro usuario do container.
    assert.equal(statSync(keyPath).mode & 0o777, 0o600)

    // 0.0.0.0, nao so loopback -- e exige credencial.
    const semAuth = await fetch(`http://127.0.0.1:${porta}/api/cards`)
    assert.equal(semAuth.status, 401)
    const auth = Buffer.from('deus:segredo').toString('base64')
    const comAuth = await fetch(`http://127.0.0.1:${porta}/api/cards`, {
      headers: { authorization: `Basic ${auth}` },
    })
    assert.equal(comAuth.status, 200)
    const corpo = await comAuth.json()
    assert.ok(corpo.cards.some((c) => c.id === 'CARD-001'))
  } finally {
    filho.kill('SIGTERM')
    await new Promise((r) => filho.on('exit', r))
  }
})
