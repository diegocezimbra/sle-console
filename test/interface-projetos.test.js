import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { criarDaemon } from '../src/daemon.js'
import { abrirBrowser, acharChrome } from './apoio/browser.js'

const chrome = await acharChrome()
const pular = chrome ? false : 'sem Chrome nesta maquina'
let base, fechar, browser

before(async () => {
  const raiz = mkdtempSync(join(tmpdir(), 'sle-mp-'))
  for (const nome of ['alfa', 'beta']) {
    const p = join(raiz, 'cliente', nome)
    mkdirSync(join(p, 'cards', 'doing'), { recursive: true })
    writeFileSync(join(p, 'cards', 'doing', `CARD-${nome}.md`),
      `---\nid: CARD-${nome}\ntitle: Tarefa do ${nome}\nstatus: doing\nrisk: baixo\n---\nx\n`)
    const git = (...a) => execFileSync('git', a, { cwd: p, stdio: 'pipe' })
    git('init', '-q', '-b', nome === 'alfa' ? 'main' : 'develop')
    git('config', 'user.email', 't@t'); git('config', 'user.name', 'T')
    git('add', '-A'); git('commit', '-qm', 'inicial')
  }
  const d = criarDaemon({ dados: mkdtempSync(join(tmpdir(), 'sle-mpd-')), raiz })
  await new Promise((r) => d.servidor.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${d.servidor.address().port}`
  fechar = () => new Promise((r) => (d.observador.parar(), d.servidor.closeAllConnections(), d.servidor.close(r)))
  if (!chrome) return
  browser = await abrirBrowser()
  await browser.ir(base)
  await browser.esperar(`document.body.dataset.pronto === 'sim'`)
})
after(async () => { await browser?.fechar(); await fechar?.() })

test('o seletor lista os projetos e a opcao de ver todos', { skip: pular }, async () => {
  await browser.esperar(`document.querySelectorAll('#projeto option').length === 3`)
  const t = await browser.avaliar(`document.getElementById('projeto').textContent`)
  assert.match(t, /todos os projetos \(2\)/, 'com dezenas de repos, ver um por vez esconde o trabalho')
  assert.match(t, /alfa/)
  assert.match(t, /beta/)
})

test('a visao de todos abre por padrao e resume os repositorios', { skip: pular }, async () => {
  await browser.esperar(`document.getElementById('git').textContent.includes('repos')`)
  const g = await browser.avaliar(`document.getElementById('git').textContent`)
  assert.match(g, /2 repos/, 'nao existe "a branch" de varios repositorios')
  assert.doesNotMatch(g, /sem git/)
})

test('escolher um projeto especifico volta a mostrar a branch dele', { skip: pular }, async () => {
  await browser.avaliar(`(() => {
    const s = document.getElementById('projeto')
    s.value = [...s.options].find(o => o.textContent.includes('alfa')).value
    s.dispatchEvent(new Event('change'))
    return true })()`)
  await browser.esperar(`document.getElementById('git').textContent.includes('main')`)
})

test('trocar de projeto troca o board e o git, sem recarregar', { skip: pular }, async () => {
  await browser.avaliar(`(() => {
    const s = document.getElementById('projeto')
    s.value = [...s.options].find(o => o.textContent.includes('beta')).value
    s.dispatchEvent(new Event('change'))
    return true })()`)
  await browser.esperar(`document.getElementById('git').textContent.includes('develop')`)
  await browser.avaliar(`document.querySelector('nav button[data-tela="board"]').click()`)
  await browser.esperar(`document.getElementById('tela-board').textContent.includes('CARD-beta')`)
  const t = await browser.avaliar(`document.getElementById('tela-board').textContent`)
  assert.doesNotMatch(t, /CARD-alfa/, 'o board precisa ser do projeto escolhido')
})

test('nenhum erro de JavaScript ao trocar de projeto', { skip: pular }, async () => {
  assert.deepEqual(browser.erros, [], browser.erros.join(' | '))
})
