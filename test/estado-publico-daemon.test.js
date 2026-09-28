import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { criarDaemon } from '../src/daemon.js'
import { ensureCloned } from '../src/gitSync.js'

function git(args, cwd) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' })
  assert.equal(r.status, 0, r.stderr)
  return r.stdout
}

/** Repositório "local" (00-DEUS de verdade seria isto): um clone com censo. */
function criarRepoLocalComCenso(censo) {
  const remoto = mkdtempSync(join(tmpdir(), 'sle-remoto-censo-'))
  git(['init', '--bare', '-b', 'main', remoto])

  const local = mkdtempSync(join(tmpdir(), 'sle-local-'))
  git(['init', '-b', 'main', local])
  git(['config', 'user.email', 'local@example.com'], local)
  git(['config', 'user.name', 'local'], local)
  writeFileSync(join(local, 'README.md'), '# repo\n')
  git(['add', 'README.md'], local)
  git(['commit', '-m', 'seed'], local)
  git(['remote', 'add', 'origin', remoto], local)
  git(['push', '-u', 'origin', 'main'], local)

  mkdirSync(join(local, 'estado'), { recursive: true })
  writeFileSync(join(local, 'estado', 'sessoes.json'), JSON.stringify(censo))
  return { remoto, local }
}

test('publicarLocal escreve o arquivo publico e empurra pro remoto', async () => {
  const censo = {
    's [aaaaaaaa]': { escopo: 'Cenvia / CARD-118 corte semanal', modelo: 'claude-sonnet-5', atualizado: new Date().toISOString() },
  }
  const { remoto, local } = criarRepoLocalComCenso(censo)

  // Intervalo curto pra não esperar o padrão de 30s: o teste espera o
  // primeiro tick real do `setInterval`, não chama a função por baixo dos panos.
  const d2 = criarDaemon({
    dados: mkdtempSync(join(tmpdir(), 'sle-dados-')),
    projeto: local,
    raiz: [local],
    publicarLocal: {
      censoPath: join(local, 'estado', 'sessoes.json'),
      publicoPath: join(local, 'estado-publico', 'sessoes.json'),
      dataDir: local,
      intervalMs: 50,
    },
  })
  await new Promise((r) => d2.servidor.listen(0, '127.0.0.1', r))
  await new Promise((r) => setTimeout(r, 300))
  d2.pararPublicarLocal()
  d2.observador.parar()
  await new Promise((r) => d2.servidor.close(r))

  const verificacao = mkdtempSync(join(tmpdir(), 'sle-verifica-censo-'))
  git(['clone', remoto, verificacao])
  const publicado = JSON.parse(readFileSync(join(verificacao, 'estado-publico', 'sessoes.json'), 'utf8'))
  assert.equal(publicado.sessoes.length, 1)
  assert.equal(publicado.sessoes[0].card, 'CARD-118')
  assert.equal(publicado.sessoes[0].modelo, 'claude-sonnet-5')
  assert.equal(publicado.sessoes[0].pid, undefined)

  // Intervalo de 50ms rodando por 300ms tica ~6x com o MESMO censo (revisão
  // do PR #4: o carimbo de tempo sozinho não pode parecer mudança) -- só o
  // primeiro tick tem o que commitar.
  const commits = git(['log', '--oneline', 'main'], verificacao).trim().split('\n')
  assert.equal(commits.length, 2, `esperava 1 commit de publish + 1 seed, veio:\n${commits.join('\n')}`)
})

test('console em modo git le o arquivo publico e devolve em /api/agents', async () => {
  const publicado = {
    atualizado: new Date().toISOString(),
    sessoes: [{ sessao: 's [bbbbbbbb]', card: 'CARD-042', modelo: 'claude-opus-5', projeto: '00-DEUS', atualizado: new Date().toISOString() }],
  }
  const remoto = mkdtempSync(join(tmpdir(), 'sle-remoto-leitura-'))
  git(['init', '--bare', '-b', 'main', remoto])
  const seed = mkdtempSync(join(tmpdir(), 'sle-seed-leitura-'))
  git(['init', '-b', 'main', seed])
  git(['config', 'user.email', 'seed@example.com'], seed)
  git(['config', 'user.name', 'seed'], seed)
  mkdirSync(join(seed, 'estado-publico'), { recursive: true })
  writeFileSync(join(seed, 'estado-publico', 'sessoes.json'), JSON.stringify(publicado))
  git(['add', 'estado-publico'], seed)
  git(['commit', '-m', 'seed'], seed)
  git(['remote', 'add', 'origin', remoto], seed)
  git(['push', 'origin', 'main'], seed)

  const dataDir = join(mkdtempSync(join(tmpdir(), 'sle-clone-leitura-')), '00-deus')
  ensureCloned({ repoUrl: remoto, dataDir, keyPath: '/dev/null', branch: 'main' })
  git(['config', 'user.email', 'console@example.com'], dataDir)
  git(['config', 'user.name', 'console'], dataDir)

  const d = criarDaemon({
    dados: mkdtempSync(join(tmpdir(), 'sle-dados-git-')),
    projeto: dataDir,
    raiz: [dataDir],
    git: { dataDir, keyPath: '/dev/null', intervalMs: 3_600_000 },
  })
  await new Promise((r) => d.servidor.listen(0, '127.0.0.1', r))
  const base = `http://127.0.0.1:${d.servidor.address().port}`

  const r = await fetch(`${base}/api/agents`)
  const j = await r.json()
  assert.equal(j.sessoes.length, 1)
  assert.equal(j.sessoes[0].card, 'CARD-042')
  assert.equal(j.sessoes[0].modelo, 'claude-opus-5')
  assert.equal(j.sessoes[0].ativa, true)

  d.observador.parar()
  d.pararGit()
  await new Promise((res) => d.servidor.close(res))
})
