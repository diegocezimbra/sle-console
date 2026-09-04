import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { descobrirProjetos, resolverProjeto } from '../src/projetos.js'

function arvore() {
  const raiz = mkdtempSync(join(tmpdir(), 'sle-pr-'))
  const repo = (caminho) => {
    mkdirSync(join(raiz, caminho, '.git'), { recursive: true })
    return join(raiz, caminho)
  }
  repo('cliente-a/api')
  repo('cliente-a/web')
  repo('cliente-b/app')
  mkdirSync(join(raiz, 'cliente-a/api/node_modules/pacote/.git'), { recursive: true })
  mkdirSync(join(raiz, 'so-uma-pasta'), { recursive: true })
  return raiz
}

test('descobre os repositorios git abaixo da raiz', () => {
  const p = descobrirProjetos(arvore())
  assert.deepEqual(p.map((x) => x.nome).sort(), ['api', 'app', 'web'])
})

test('node_modules nao vira projeto', () => {
  assert.equal(descobrirProjetos(arvore()).some((p) => p.caminho.includes('node_modules')), false)
})

test('pasta sem git nao vira projeto', () => {
  assert.equal(descobrirProjetos(arvore()).some((p) => p.nome === 'so-uma-pasta'), false)
})

test('o rotulo mostra de qual cliente o projeto e', () => {
  const p = descobrirProjetos(arvore())
  const api = p.find((x) => x.nome === 'api')
  assert.equal(api.rotulo, 'cliente-a/api', 'dois "api" de clientes diferentes precisam se distinguir')
})

test('a lista vem ordenada, para o seletor nao dancar a cada boot', () => {
  const nomes = descobrirProjetos(arvore()).map((p) => p.rotulo)
  assert.deepEqual(nomes, [...nomes].sort())
})

test('repositorio dentro de repositorio tambem e projeto', () => {
  const raiz = arvore()
  // a propria raiz e um repo, e mesmo assim os de dentro contam
  mkdirSync(join(raiz, '.git'), { recursive: true })
  const nomes = descobrirProjetos(raiz).map((p) => p.nome)
  assert.ok(nomes.includes('api'), 'parar no primeiro .git esconde os 40 repos de dentro')
  assert.ok(nomes.includes('app'))
})

test('pasta com cards/ e projeto mesmo sem git', () => {
  const raiz = arvore()
  mkdirSync(join(raiz, 'sem-git', 'cards', 'doing'), { recursive: true })
  assert.ok(descobrirProjetos(raiz).some((p) => p.nome === 'sem-git'),
    'o que define um projeto do SLE e ter cards, nao ter git')
})

test('varias raizes: observa clientes em pastas diferentes de uma vez', () => {
  const a = arvore()
  const b = arvore()
  const p = descobrirProjetos([a, b])
  assert.equal(p.length, 6, 'tres repos em cada raiz')
})

test('raiz repetida nao duplica projeto', () => {
  const a = arvore()
  assert.equal(descobrirProjetos([a, a]).length, 3)
})

test('raiz inexistente na lista nao derruba as outras', () => {
  const a = arvore()
  assert.equal(descobrirProjetos([a, '/nao/existe']).length, 3)
})

test('raiz inexistente devolve lista vazia em vez de estourar', () => {
  assert.deepEqual(descobrirProjetos('/caminho/que/nao/existe'), [])
})

test('resolver aceita o pedido quando ele esta na lista', () => {
  const raiz = arvore()
  const alvo = join(raiz, 'cliente-b/app')
  assert.equal(resolverProjeto(raiz, alvo), alvo)
})

test('projeto de fora da raiz e recusado: a URL nao escolhe qualquer pasta', () => {
  const raiz = arvore()
  const fora = resolverProjeto(raiz, '/etc')
  assert.notEqual(fora, '/etc')
  assert.ok(fora.startsWith(raiz), 'cai no primeiro projeto valido, e nao no que a URL pediu')
})

test('sem pedido, resolve para o primeiro projeto', () => {
  const raiz = arvore()
  assert.ok(resolverProjeto(raiz, null).endsWith('cliente-a/api'))
})

test('raiz sem nenhum repositorio devolve a propria raiz', () => {
  const vazia = mkdtempSync(join(tmpdir(), 'sle-vz-'))
  assert.equal(resolverProjeto(vazia, null), vazia)
})
