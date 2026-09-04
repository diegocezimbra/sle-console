import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { observarArvore } from '../src/watcher.js'

const esperarEvento = (w, limite = 4000) =>
  new Promise((ok, erro) => {
    const prazo = setTimeout(() => erro(new Error('o watcher nao avisou a tempo')), limite)
    w.aoMudar((e) => {
      clearTimeout(prazo)
      ok(e)
    })
  })

test('mudanca em cards/ e avisada com o caminho relativo', async () => {
  const raiz = mkdtempSync(join(tmpdir(), 'sle-w-'))
  mkdirSync(join(raiz, 'cards', 'doing'), { recursive: true })
  const w = observarArvore(raiz, ['cards'])
  const evento = esperarEvento(w)
  await new Promise((r) => setTimeout(r, 120))
  writeFileSync(join(raiz, 'cards', 'doing', 'CARD-1.md'), '---\nid: X\n---\n')
  const e = await evento
  assert.match(e.caminho, /cards[/\\]doing[/\\]CARD-1\.md/)
  w.parar()
})

test('pasta fora da lista observada nao gera ruido', async () => {
  const raiz = mkdtempSync(join(tmpdir(), 'sle-w2-'))
  mkdirSync(join(raiz, 'cards'), { recursive: true })
  mkdirSync(join(raiz, 'node_modules'), { recursive: true })
  const w = observarArvore(raiz, ['cards'])
  let avisos = 0
  w.aoMudar(() => avisos++)
  await new Promise((r) => setTimeout(r, 120))
  writeFileSync(join(raiz, 'node_modules', 'x.js'), 'ruido')
  await new Promise((r) => setTimeout(r, 400))
  assert.equal(avisos, 0)
  w.parar()
})

test('pasta inexistente nao derruba o daemon', () => {
  const raiz = mkdtempSync(join(tmpdir(), 'sle-w3-'))
  const w = observarArvore(raiz, ['cards', 'sle', 'docs'])
  assert.equal(typeof w.parar, 'function')
  w.parar()
})

test('rajada de escritas vira um aviso so', async () => {
  const raiz = mkdtempSync(join(tmpdir(), 'sle-w4-'))
  mkdirSync(join(raiz, 'cards'), { recursive: true })
  const w = observarArvore(raiz, ['cards'], { espera: 150 })
  let avisos = 0
  w.aoMudar(() => avisos++)
  await new Promise((r) => setTimeout(r, 120))
  for (let i = 0; i < 8; i++) writeFileSync(join(raiz, 'cards', `c${i}.md`), 'x')
  await new Promise((r) => setTimeout(r, 600))
  assert.equal(avisos, 1, `salvar em rajada nao pode virar 8 recargas (foram ${avisos})`)
  w.parar()
})
