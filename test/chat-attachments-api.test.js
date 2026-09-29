import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { criarDaemon } from '../src/daemon.js'
import { ensureCloned } from '../src/gitSync.js'
import { makePng } from './apoio/png.js'

const git = (args, cwd) => {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' })
  assert.equal(r.status, 0, r.stderr)
  return r.stdout
}
const png = makePng(16, 16, [10, 120, 200])
const send = (base, body) => fetch(`${base}/api/chat/attachments`, { method: 'POST', body: JSON.stringify(body) })
const anexo = (buf = png) => ({ tipo: 'image/png', dados: buf.toString('base64') })

async function subir(opcoes = {}) {
  const d = criarDaemon({ dados: mkdtempSync(join(tmpdir(), 'sle-anx-d-')), ...opcoes })
  await new Promise((r) => d.servidor.listen(0, '127.0.0.1', r))
  return {
    base: `http://127.0.0.1:${d.servidor.address().port}`,
    fechar: () => new Promise((r) => { d.observador.parar(); d.pararGit(); d.servidor.closeAllConnections(); d.servidor.close(r) }),
  }
}

let dir, s
before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'sle-anx-dir-'))
  process.env.CONSOLE_CHAT_DIR = dir
  s = await subir()
})
after(async () => {
  delete process.env.CONSOLE_CHAT_DIR
  await s?.fechar()
})

test('POST /api/chat/attachments grava a imagem, a mensagem e devolve o caminho do anexo', async () => {
  const r = await send(s.base, { texto: 'olha o erro', anexos: [anexo()] })
  assert.equal(r.status, 200)
  const { mensagem } = await r.json()
  assert.equal(mensagem.de, 'diego')
  assert.equal(mensagem.anexos.length, 1)
  assert.match(mensagem.anexos[0].arquivo, /^chat\/anexos\/\d{4}-\d{2}-\d{2}\/[\w-]+-1\.png$/)
  assert.deepEqual(readFileSync(join(dir, mensagem.anexos[0].arquivo)), png)
  assert.match(mensagem.texto, /^olha o erro\n\n\[anexo: chat\/anexos\//)
  const { mensagens } = await (await fetch(`${s.base}/api/chat?dias=1`)).json()
  assert.deepEqual(mensagens.find((m) => m.id === mensagem.id).anexos, mensagem.anexos)
})

test('GET do anexo devolve os bytes com o tipo certo e cache longo; nome fora do padrao e 404', async () => {
  const { mensagem } = await (await send(s.base, { texto: 'x', anexos: [anexo()] })).json()
  const [, dia, nome] = /^chat\/anexos\/([\d-]+)\/(.+)$/.exec(mensagem.anexos[0].arquivo)
  const r = await fetch(`${s.base}/api/chat/anexos/${dia}/${nome}`)
  assert.equal(r.status, 200)
  assert.equal(r.headers.get('content-type'), 'image/png')
  assert.match(r.headers.get('cache-control'), /immutable/)
  assert.deepEqual(Buffer.from(await r.arrayBuffer()), png)
  for (const ruim of [`${dia}/..%2f..%2fjsonl`, `${dia}/x.svg`, `2026-13-99/${nome}`, `${dia}/nao-existe-1.png`, `../${nome}`, `${dia}/${nome}/x`]) {
    assert.equal((await fetch(`${s.base}/api/chat/anexos/${ruim}`)).status, 404, ruim)
  }
})

test('recusa o que nao e imagem (422), mais de 4 (422) e corpo acima de 8 MB (413)', async () => {
  assert.equal((await send(s.base, { texto: 'a', anexos: [{ dados: Buffer.from('#!/bin/sh').toString('base64') }] })).status, 422)
  assert.equal((await send(s.base, { texto: 'a', anexos: Array.from({ length: 5 }, () => anexo()) })).status, 422)
  assert.equal((await send(s.base, { texto: 'a', anexos: [] })).status, 422)
  assert.equal((await fetch(`${s.base}/api/chat/attachments`, { method: 'POST', body: 'nao e json' })).status, 422)
  assert.equal((await send(s.base, { texto: 'a', anexos: [{ dados: 'A'.repeat(9 * 1024 * 1024) }] })).status, 413)
})

test('so a imagem, sem texto, e aceita; texto com segredo continua so avisando', async () => {
  const so = await send(s.base, { texto: '', anexos: [anexo()] })
  assert.equal(so.status, 200)
  const seg = await send(s.base, { texto: 'ghp_' + 'z'.repeat(30), anexos: [anexo()] })
  assert.equal(seg.status, 200)
  assert.equal((await seg.json()).aviso, 'secret')
})

test('o POST de texto puro continua com o limite de 64 KB (o de imagem e outra rota)', async () => {
  const grande = await fetch(`${s.base}/api/chat`, { method: 'POST', body: JSON.stringify({ texto: 'x'.repeat(70_000) }) })
  assert.equal(grande.status, 413)
})

test('modo git: a imagem entra no mesmo commit da mensagem e chega ao remoto', async () => {
  const remoto = mkdtempSync(join(tmpdir(), 'sle-anx-r-'))
  git(['init', '--bare', '-b', 'main', remoto])
  const seed = mkdtempSync(join(tmpdir(), 'sle-anx-s-'))
  git(['init', '-b', 'main', seed])
  for (const [k, v] of [['user.email', 's@x'], ['user.name', 's']]) git(['config', k, v], seed)
  mkdirSync(join(seed, 'cards', 'doing'), { recursive: true })
  writeFileSync(join(seed, 'cards', 'doing', '.keep'), '')
  git(['add', 'cards'], seed); git(['commit', '-m', 'seed'], seed)
  git(['remote', 'add', 'origin', remoto], seed); git(['push', 'origin', 'main'], seed)
  const dataDir = join(mkdtempSync(join(tmpdir(), 'sle-anx-c-')), '00-deus')
  ensureCloned({ repoUrl: remoto, dataDir, keyPath: '/dev/null', branch: 'main' })
  for (const [k, v] of [['user.email', 'c@x'], ['user.name', 'c']]) git(['config', k, v], dataDir)
  delete process.env.CONSOLE_CHAT_DIR
  const g = await subir({ projeto: dataDir, raiz: [dataDir], git: { dataDir, keyPath: '/dev/null', intervalMs: 3_600_000 } })
  process.env.CONSOLE_CHAT_DIR = dir
  try {
    const r = await send(g.base, { texto: 'foto pelo git', anexos: [anexo()] })
    assert.equal(r.status, 200)
    const { mensagem, sync } = await r.json()
    assert.equal(sync, undefined)
    const arquivos = git(['ls-tree', '-r', '--name-only', 'main'], remoto)
    assert.ok(arquivos.includes(mensagem.anexos[0].arquivo), 'a imagem foi empurrada')
    assert.match(git(['log', '-1', '--format=%s', 'main'], remoto), /^chat: mensagem do Diego/)
    assert.equal(existsSync(join(dataDir, mensagem.anexos[0].arquivo)), true)
  } finally {
    await g.fechar()
  }
})
