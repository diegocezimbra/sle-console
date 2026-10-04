/**
 * CARD-226/288 -- o censo do console sai do checkout do 00-DEUS pelo MESMO caminho do publish de
 * cards (`deus publicar-censo`: clone privado, merge de 3 vias, push simples) e nunca por
 * `git commit`/`push`/`pull --rebase` na `main` do checkout. Aqui: o pedido em si.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { criarSolicitadorPublicacao } from '../src/publicarCenso.js'

/** Um "00-DEUS" de mentira: `bin/deus` é o script de teste; devolve a pasta. */
function deusDeMentira(corpo) {
  const home = mkdtempSync(join(tmpdir(), 'sle-deus-'))
  mkdirSync(join(home, 'bin'))
  writeFileSync(join(home, 'bin', 'deus'), `#!/bin/sh\n${corpo}\n`)
  chmodSync(join(home, 'bin', 'deus'), 0o755)
  return home
}

test('pede a publicacao com `bin/deus publicar-censo` do repositorio do censo, que vira o DEUS_HOME', async () => {
  const saida = join(mkdtempSync(join(tmpdir(), 'sle-saida-')), 'chamada')
  const home = deusDeMentira(`printf '%s|%s\\n' "$*" "$DEUS_HOME" > "${saida}"`)

  const r = await criarSolicitadorPublicacao({ deusHome: home })()

  assert.deepEqual(r, { ok: true })
  assert.equal(readFileSync(saida, 'utf8').trim(), `publicar-censo|${home}`)
})

test('o ambiente extra (marcador, remoto de teste) chega ao comando sem apagar o do processo', async () => {
  const saida = join(mkdtempSync(join(tmpdir(), 'sle-saida-')), 'env')
  const home = deusDeMentira(`printf '%s|%s\\n' "$DEUS_PUBLISH_DEBOUNCE" "$PATH" > "${saida}"`)

  await criarSolicitadorPublicacao({ deusHome: home, env: { DEUS_PUBLISH_DEBOUNCE: '0' } })()

  const [debounce, path] = readFileSync(saida, 'utf8').trim().split('|')
  assert.equal(debounce, '0')
  assert.equal(path, process.env.PATH, 'o PATH do daemon precisa seguir valendo (git, jq, flock)')
})

test('comando que sai com erro vira { ok:false } com o status e o stderr -- nunca lanca', async () => {
  const home = deusDeMentira('echo "git ocupado" >&2; exit 3')

  const r = await criarSolicitadorPublicacao({ deusHome: home })()

  assert.equal(r.ok, false)
  assert.equal(r.status, 3)
  assert.match(r.erro, /git ocupado/)
})

test('instalacao sem bin/deus (clone da nuvem, caminho errado) vira { ok:false }, sem derrubar o daemon', async () => {
  const semBin = mkdtempSync(join(tmpdir(), 'sle-sem-bin-'))

  const r = await criarSolicitadorPublicacao({ deusHome: semBin })()

  assert.equal(r.ok, false)
  assert.match(r.erro, /ENOENT/)
})

test('volta assim que o comando sai, mesmo que ele deixe o publish rodando em segundo plano', async () => {
  const home = deusDeMentira('sleep 3 >/dev/null 2>&1 </dev/null &\nexit 0')
  const t0 = Date.now()

  const r = await criarSolicitadorPublicacao({ deusHome: home })()

  assert.equal(r.ok, true)
  assert.ok(Date.now() - t0 < 2000, `o pedido nao pode esperar o publish (levou ${Date.now() - t0}ms)`)
})

test('comando travado e morto no limite de tempo e vira { ok:false }', async () => {
  const home = deusDeMentira('exec sleep 5')
  const t0 = Date.now()

  const r = await criarSolicitadorPublicacao({ deusHome: home, timeoutMs: 200 })()

  assert.equal(r.ok, false)
  assert.ok(Date.now() - t0 < 2000, 'o limite de tempo precisa valer')
})

test('o publicador do censo nao importa nem usa git: o caminho do censo nao faz commit/push/pull', () => {
  const fonte = readFileSync(new URL('../src/publicarCenso.js', import.meta.url), 'utf8')
  const codigo = fonte.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n')
  assert.doesNotMatch(codigo, /gitSync|commitAndPush|'git'|"git"|pull --rebase|\bpush\b/)
  assert.equal(existsSync(new URL('../src/publicarCenso.js', import.meta.url)), true)
})
