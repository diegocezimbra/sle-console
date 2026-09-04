import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { lerConfig } from '../src/config.js'

const dir = () => mkdtempSync(join(tmpdir(), 'sle-cfg-'))

test('config ausente vira o padrao, e nao um erro', () => {
  const c = lerConfig(join(dir(), 'nao-existe.json'))
  assert.equal(c.porta, 7717)
  assert.deepEqual(c.observar, [process.cwd()])
})

test('le as pastas observadas', () => {
  const d = dir()
  const arq = join(d, 'config.json')
  writeFileSync(arq, JSON.stringify({ observar: ['/a', '/b'], porta: 8000 }))
  const c = lerConfig(arq)
  assert.deepEqual(c.observar, ['/a', '/b'])
  assert.equal(c.porta, 8000)
})

test('caminho com ~ vira o home, porque e o que a pessoa digita', () => {
  const d = dir()
  const arq = join(d, 'c.json')
  writeFileSync(arq, JSON.stringify({ observar: ['~/projetos'] }))
  assert.equal(lerConfig(arq).observar[0], join(process.env.HOME, 'projetos'))
})

test('json quebrado avisa e cai no padrao em vez de derrubar o daemon', () => {
  const d = dir()
  const arq = join(d, 'c.json')
  writeFileSync(arq, '{ quebrado')
  const c = lerConfig(arq)
  assert.equal(c.porta, 7717)
  assert.match(c.aviso, /config/i)
})

test('campos parciais herdam o resto do padrao', () => {
  const d = dir()
  const arq = join(d, 'c.json')
  writeFileSync(arq, JSON.stringify({ tetoDiarioUsd: 25 }))
  const c = lerConfig(arq)
  assert.equal(c.tetoDiarioUsd, 25)
  assert.equal(c.porta, 7717)
})

test('observar como texto simples tambem vale', () => {
  const d = dir()
  const arq = join(d, 'c.json')
  writeFileSync(arq, JSON.stringify({ observar: '/so/uma' }))
  assert.deepEqual(lerConfig(arq).observar, ['/so/uma'])
})
