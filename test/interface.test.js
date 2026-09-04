import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { criarDaemon } from '../src/daemon.js'
import { abrirBrowser, acharChrome } from './apoio/browser.js'

// Resolvido antes de os testes serem definidos: `skip` e avaliado na definicao,
// nao na execucao -- decidir isso dentro do `before` pula tudo, sempre.
const chrome = await acharChrome()
const pular = chrome ? false : 'sem Chrome nesta maquina'

let base, fechar, browser

before(async () => {
  const d = criarDaemon({ dados: mkdtempSync(join(tmpdir(), 'sle-ui-')) })
  await new Promise((r) => d.servidor.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${d.servidor.address().port}`
  fechar = () => new Promise((r) => (d.observador.parar(), d.servidor.closeAllConnections(), d.servidor.close(r)))

  const hook = (o) => fetch(`${base}/api/hook`, { method: 'POST', body: JSON.stringify(o) })
  await hook({ session_id: 's1', hook_event_name: 'SessionStart', agent_type: 'implementer' })
  await hook({ session_id: 's1', hook_event_name: 'PostToolUse', tool_name: 'Edit',
    tool_input: { file_path: 'core/auth/TokenStore.kt' }, tool_response: { success: true }, duration_ms: 412 })
  await hook({ session_id: 's1', hook_event_name: 'PostToolUse', tool_name: 'Bash',
    tool_input: { command: './gradlew test' }, tool_response: { success: false }, duration_ms: 41200 })

  if (!chrome) return
  browser = await abrirBrowser()
  await browser.ir(base)
  await browser.esperar(`document.body.dataset.pronto === 'sim'`)
})

after(async () => {
  await browser?.fechar()
  await fechar?.()
})

test('a pagina monta sem erro de JavaScript', { skip: pular }, async () => {
  await browser.esperar(`document.querySelectorAll('#fluxo li:not(.vazio)').length > 0`)
  assert.deepEqual(browser.erros, [], `a pagina registrou erro: ${browser.erros.join(' | ')}`)
})

test('o fluxo pinta os eventos que vieram do snapshot', { skip: pular }, async () => {
  await browser.esperar(`document.querySelectorAll('#fluxo li:not(.vazio)').length === 3`)
  const texto = await browser.avaliar(`document.getElementById('fluxo').textContent`)
  assert.match(texto, /TokenStore\.kt/)
  assert.match(texto, /412ms/)
})

test('falha de ferramenta aparece marcada, e nao igual ao sucesso', { skip: pular }, async () => {
  const falhas = await browser.avaliar(`document.querySelectorAll('#fluxo li.falha').length`)
  assert.equal(falhas, 1)
})

test('o painel de agentes mostra a sessao viva', { skip: pular }, async () => {
  const texto = await browser.avaliar(`document.getElementById('sessoes').textContent`)
  assert.match(texto, /implementer/)
  // "há 3s" diz mais que "ativa": a idade do último sinal é o que separa quem
  // está trabalhando de quem só não mandou SessionEnd.
  assert.match(texto, /há \d+s/)
  assert.doesNotMatch(texto, /inativa/)
})

test('a regua desenha de verdade, e nao fica em branco', { skip: pular }, async () => {
  // um canvas pintado tem pixel com alfa; um canvas vazio nao tem nenhum.
  const pintou = await browser.avaliar(`(() => {
    const c = document.getElementById('regua')
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data
    for (let i = 3; i < d.length; i += 4) if (d[i] > 0) return true
    return false
  })()`)
  assert.equal(pintou, true, 'a regua de loops ficou em branco')
})

test('o SSE atualiza a tela sem recarregar', { skip: pular }, async () => {
  await fetch(`${base}/api/hook`, { method: 'POST', body: JSON.stringify({
    session_id: 's2', hook_event_name: 'PostToolUse', tool_name: 'Write',
    tool_input: { file_path: 'novo/arquivo.ts' }, tool_response: { success: true } }) })
  await browser.esperar(`document.getElementById('fluxo').textContent.includes('novo/arquivo.ts')`)
  const conexao = await browser.avaliar(`document.getElementById('conexao').textContent`)
  assert.match(conexao, /ao vivo/)
})
