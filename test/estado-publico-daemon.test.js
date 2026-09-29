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

/** Repositório "local" (00-DEUS de verdade seria isto): um clone vazio, sem
 *  censo nenhum -- a fonte agora é o `Estado` vivo do próprio daemon. */
function criarRepoLocal() {
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
  return { remoto, local }
}

test('publicarLocal publica a sessao viva de verdade (hook real), nao um censo estatico', async () => {
  const { remoto, local } = criarRepoLocal()

  const d = criarDaemon({
    dados: mkdtempSync(join(tmpdir(), 'sle-dados-')),
    projeto: local,
    raiz: [local],
    publicarLocal: {
      publicoPath: join(local, 'estado-publico', 'sessoes.json'),
      dataDir: local,
      intervalMs: 50,
    },
  })
  await new Promise((r) => d.servidor.listen(0, '127.0.0.1', r))
  const base = `http://127.0.0.1:${d.servidor.address().port}`

  // O mesmo caminho que os hooks de verdade batem: session_id + card
  // (injetado pelo deus-hook-console) chegando como evento de sessão viva.
  await fetch(`${base}/api/hook`, {
    method: 'POST',
    body: JSON.stringify({
      session_id: 'sess-viva', hook_event_name: 'PostToolUse', card: 'CARD-118',
      cwd: '/home/linux/Documents/00-projetos/01-ohanax/13-chatomnichannel',
      tool_name: 'Edit', tool_input: { file_path: 'a.ts' }, tool_response: { success: true },
    }),
  })

  await new Promise((r) => setTimeout(r, 300))
  d.pararPublicarLocal()
  d.observador.parar()
  await new Promise((r) => d.servidor.close(r))

  const verificacao = mkdtempSync(join(tmpdir(), 'sle-verifica-censo-'))
  git(['clone', remoto, verificacao])
  const publicado = JSON.parse(readFileSync(join(verificacao, 'estado-publico', 'sessoes.json'), 'utf8'))
  assert.equal(publicado.sessoes.length, 1)
  assert.equal(publicado.sessoes[0].card, 'CARD-118')
  assert.equal(publicado.sessoes[0].ativa, true)
  assert.equal(publicado.sessoes[0].projeto, '13-chatomnichannel')
  assert.ok(publicado.eventos.length >= 1, 'o fluxo redigido tambem precisa ir junto, pra regua')

  // Intervalo de 50ms rodando por 300ms tica ~6x sem evento novo -- só o
  // primeiro tick tem o que commitar (revisão do PR #4).
  const commits = git(['log', '--oneline', 'main'], verificacao).trim().split('\n')
  assert.equal(commits.length, 2, `esperava 1 commit de publish + 1 seed, veio:\n${commits.join('\n')}`)
})

test('console em modo git le o arquivo publico: sessao viva vira ativa:true com card e ultimoPasso', async () => {
  const publicado = {
    atualizado: new Date().toISOString(),
    sessoes: [{
      sessao: 's [bbbbbbbb]', card: 'CARD-042', projeto: '00-DEUS', ultimoPasso: 'tool.post',
      eventos: 5, ultimo: new Date().toISOString(),
    }],
    eventos: [{ ts: new Date().toISOString(), loop: 'L1', kind: 'tool.post', session: 's [bbbbbbbb]' }],
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
  assert.equal(j.sessoes[0].ultimoPasso, 'tool.post')
  assert.equal(j.sessoes[0].ativa, true)

  const snap = await (await fetch(`${base}/api/snapshot`)).json()
  assert.ok(snap.fluxo.some((e) => e.session === 's [bbbbbbbb]'), 'a regua precisa ver o evento publicado')

  d.observador.parar()
  d.pararGit()
  await new Promise((res) => d.servidor.close(res))
})

test('console em modo git: sessao publicada com ultimo evento ha muito tempo vira ativa:false', async () => {
  const publicado = {
    atualizado: new Date().toISOString(),
    sessoes: [{
      sessao: 's [cccccccc]', card: null, projeto: '00-DEUS', ultimoPasso: 'tool.post',
      eventos: 1, ultimo: '2020-01-01T00:00:00Z',
    }],
    eventos: [],
  }
  const remoto = mkdtempSync(join(tmpdir(), 'sle-remoto-velha-'))
  git(['init', '--bare', '-b', 'main', remoto])
  const seed = mkdtempSync(join(tmpdir(), 'sle-seed-velha-'))
  git(['init', '-b', 'main', seed])
  git(['config', 'user.email', 'seed@example.com'], seed)
  git(['config', 'user.name', 'seed'], seed)
  mkdirSync(join(seed, 'estado-publico'), { recursive: true })
  writeFileSync(join(seed, 'estado-publico', 'sessoes.json'), JSON.stringify(publicado))
  git(['add', 'estado-publico'], seed)
  git(['commit', '-m', 'seed'], seed)
  git(['remote', 'add', 'origin', remoto], seed)
  git(['push', 'origin', 'main'], seed)

  const dataDir = join(mkdtempSync(join(tmpdir(), 'sle-clone-velha-')), '00-deus')
  ensureCloned({ repoUrl: remoto, dataDir, keyPath: '/dev/null', branch: 'main' })
  git(['config', 'user.email', 'console@example.com'], dataDir)
  git(['config', 'user.name', 'console'], dataDir)

  const d = criarDaemon({
    dados: mkdtempSync(join(tmpdir(), 'sle-dados-git2-')),
    projeto: dataDir,
    raiz: [dataDir],
    git: { dataDir, keyPath: '/dev/null', intervalMs: 3_600_000 },
  })
  await new Promise((r) => d.servidor.listen(0, '127.0.0.1', r))
  const base = `http://127.0.0.1:${d.servidor.address().port}`

  const j = await (await fetch(`${base}/api/agents`)).json()
  assert.equal(j.sessoes[0].ativa, false)

  d.observador.parar()
  d.pararGit()
  await new Promise((res) => d.servidor.close(res))
})
