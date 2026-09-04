import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { criarDaemon } from '../src/daemon.js'
import { abrirBrowser, acharChrome } from './apoio/browser.js'

const chrome = await acharChrome()
const pular = chrome ? false : 'sem Chrome nesta maquina'
let base, fechar, browser, projeto

before(async () => {
  projeto = mkdtempSync(join(tmpdir(), 'sle-ed-'))
  mkdirSync(join(projeto, 'sle', 'gates'), { recursive: true })
  mkdirSync(join(projeto, 'sle', 'prompts'), { recursive: true })
  writeFileSync(join(projeto, 'sle', 'gates', 'pipeline.json'),
    JSON.stringify({ stages: [], gates: [{ id: 'G1', name: 'Requisitos', after: 'E1', mode: 'human',
      verify: { type: 'command', run: 'echo verificado' } }] }, null, 2))
  writeFileSync(join(projeto, 'sle', 'prompts', 'implement.md'), '# Implementar\n\nEscreva o codigo.\n')

  const d = criarDaemon({ dados: mkdtempSync(join(tmpdir(), 'sle-edd-')), projeto })
  await new Promise((r) => d.servidor.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${d.servidor.address().port}`
  fechar = () => new Promise((r) => (d.observador.parar(), d.servidor.closeAllConnections(), d.servidor.close(r)))
  if (!chrome) return
  browser = await abrirBrowser()
  await browser.ir(base)
  await browser.esperar(`document.body.dataset.pronto === 'sim'`)
})
after(async () => { await browser?.fechar(); await fechar?.() })

const irParaEditar = async () => {
  await browser.avaliar(`document.querySelector('nav button[data-tela="editar"]').click()`)
  await browser.esperar(`document.getElementById('tela-editar').hidden === false`)
}

test('a aba de edicao lista os arquivos editaveis', { skip: pular }, async () => {
  await irParaEditar()
  await browser.esperar(`document.querySelectorAll('#arquivos li').length > 0`)
  const texto = await browser.avaliar(`document.getElementById('arquivos').textContent`)
  assert.match(texto, /pipeline\.json/)
  assert.match(texto, /implement\.md/)
})

test('abrir um arquivo carrega o conteudo real do disco', { skip: pular }, async () => {
  await browser.avaliar(`[...document.querySelectorAll('#arquivos button')]
    .find(b => b.textContent.includes('pipeline.json')).click()`)
  await browser.esperar(`document.getElementById('editor').value.includes('Requisitos')`)
})

test('salvar grava no disco', { skip: pular }, async () => {
  const novo = JSON.stringify({ stages: [], gates: [
    { id: 'G1', name: 'Requisitos revisados', after: 'E1', mode: 'human' }] }, null, 2)
  await browser.avaliar(`(() => {
    const e = document.getElementById('editor'); e.value = ${JSON.stringify(novo)}; return true })()`)
  await browser.avaliar(`document.getElementById('salvar').click()`)
  await browser.esperar(`document.getElementById('aviso').textContent.includes('salvo')`)
  assert.match(readFileSync(join(projeto, 'sle/gates/pipeline.json'), 'utf8'), /Requisitos revisados/)
})

test('conteudo invalido mostra o erro e nao diz que salvou', { skip: pular }, async () => {
  await browser.avaliar(`(() => { document.getElementById('editor').value = '{ quebrado'; return true })()`)
  await browser.avaliar(`document.getElementById('salvar').click()`)
  await browser.esperar(`document.getElementById('aviso').classList.contains('erro')`)
  const aviso = await browser.avaliar(`document.getElementById('aviso').textContent`)
  assert.match(aviso, /JSON/i)
  assert.doesNotMatch(aviso, /salvo/)
  assert.match(readFileSync(join(projeto, 'sle/gates/pipeline.json'), 'utf8'), /Requisitos revisados/)
})

test('"testar agora" roda o comando e mostra a saida real', { skip: pular }, async () => {
  await browser.avaliar(`(() => {
    document.getElementById('comando').value = 'echo saida-de-verdade'; return true })()`)
  await browser.avaliar(`document.getElementById('testar').click()`)
  await browser.esperar(`document.getElementById('saida').textContent.includes('saida-de-verdade')`)
  const saida = await browser.avaliar(`document.getElementById('saida').textContent`)
  assert.match(saida, /exit 0/)
})

test('nenhum erro de JavaScript na tela de edicao', { skip: pular }, async () => {
  assert.deepEqual(browser.erros, [], browser.erros.join(' | '))
})
