import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync } from 'node:fs'
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

const CARD_001 = `---
id: CARD-001
titulo: Card de teste
status: pendente-diego
---

## Opções
- A: sim
- B: nao
`

/** Bare repo local em vez de GitHub -- `file://` não precisa de chave SSH. */
function criarRemotoComCard() {
  const remoto = mkdtempSync(join(tmpdir(), 'sle-remote-'))
  git(['init', '--bare', '-b', 'main', remoto])

  const seed = mkdtempSync(join(tmpdir(), 'sle-seed-'))
  git(['init', '-b', 'main', seed])
  git(['config', 'user.email', 'seed@example.com'], seed)
  git(['config', 'user.name', 'seed'], seed)
  mkdirSync(join(seed, 'cards', 'pendente-diego'), { recursive: true })
  writeFileSync(join(seed, 'cards', 'pendente-diego', 'CARD-001.md'), CARD_001)
  git(['add', 'cards'], seed)
  git(['commit', '-m', 'seed'], seed)
  git(['remote', 'add', 'origin', remoto], seed)
  git(['push', 'origin', 'main'], seed)
  return remoto
}

async function subirEmModoGit() {
  const remoto = criarRemotoComCard()
  const dataDir = join(mkdtempSync(join(tmpdir(), 'sle-clone-')), '00-deus')
  ensureCloned({ repoUrl: remoto, dataDir, keyPath: '/dev/null', branch: 'main' })
  git(['config', 'user.email', 'console@example.com'], dataDir)
  git(['config', 'user.name', 'console'], dataDir)

  const d = criarDaemon({
    dados: mkdtempSync(join(tmpdir(), 'sle-dados-')),
    projeto: dataDir,
    raiz: [dataDir],
    git: { dataDir, keyPath: '/dev/null', intervalMs: 3_600_000 }, // loop desligado na prática: cada teste chama a API direto
  })
  await new Promise((r) => d.servidor.listen(0, '127.0.0.1', r))
  const base = `http://127.0.0.1:${d.servidor.address().port}`
  const fechar = () =>
    new Promise((r) => {
      d.observador.parar()
      d.pararGit()
      d.servidor.closeAllConnections()
      d.servidor.close(r)
    })
  return { base, fechar, remoto, dataDir }
}

test('/api/health responde sem exigir projeto nem git', async () => {
  const { base, fechar } = await subirEmModoGit()
  const r = await fetch(`${base}/api/health`)
  assert.equal(r.status, 200)
  await fechar()
})

test('answer em modo git commita e empurra pro remoto', async () => {
  const { base, fechar, remoto } = await subirEmModoGit()
  const r = await fetch(`${base}/api/cards/CARD-001/answer`, {
    method: 'POST',
    body: JSON.stringify({ option: 'A', text: 'segue com a opção A' }),
  })
  assert.equal(r.status, 200)

  const verificacao = mkdtempSync(join(tmpdir(), 'sle-verifica-'))
  git(['clone', remoto, verificacao])
  const conteudo = readFileSync(join(verificacao, 'cards', 'pendente-diego', 'CARD-001.md'), 'utf8')
  assert.match(conteudo, /Resposta do Diego/)
  assert.match(conteudo, /segue com a opção A/)
  const log = git(['log', '-1', '--format=%s'], verificacao)
  assert.match(log, /resposta do Diego: CARD-001/)
  await fechar()
})

test('resolve em modo git move o card pra aprovado sem "deus task move" e empurra', async () => {
  const { base, fechar, remoto } = await subirEmModoGit()
  const r = await fetch(`${base}/api/cards/CARD-001/resolve`, {
    method: 'POST',
    body: JSON.stringify({ option: 'A', text: 'resolvido' }),
  })
  assert.equal(r.status, 200)
  assert.deepEqual(await r.json(), { ok: true, id: 'CARD-001', coluna: 'aprovado' })

  const verificacao = mkdtempSync(join(tmpdir(), 'sle-verifica-'))
  git(['clone', remoto, verificacao])
  const caminhoAprovado = join(verificacao, 'cards', 'aprovado', 'CARD-001.md')
  const conteudo = readFileSync(caminhoAprovado, 'utf8')
  assert.match(conteudo, /status: aprovado/)
  assert.match(conteudo, /Pendência resolvida pelo Diego/)
  const status = git(['status', '--porcelain'], verificacao)
  assert.equal(status.includes('pendente-diego'), false)
  await fechar()
})

test('move em modo git também empurra pro remoto', async () => {
  const { base, fechar, remoto } = await subirEmModoGit()
  const r = await fetch(`${base}/api/cards/CARD-001/move`, {
    method: 'POST',
    body: JSON.stringify({ para: 'doing' }),
  })
  assert.equal(r.status, 200)

  const verificacao = mkdtempSync(join(tmpdir(), 'sle-verifica-'))
  git(['clone', remoto, verificacao])
  assert.equal(
    readFileSync(join(verificacao, 'cards', 'doing', 'CARD-001.md'), 'utf8').includes('status: doing'),
    true
  )
  await fechar()
})
