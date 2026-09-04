import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { criarDaemon } from '../src/daemon.js'

async function subir() {
  const d = criarDaemon({ dados: mkdtempSync(join(tmpdir(), 'sle-d-')) })
  await new Promise((r) => d.servidor.listen(0, '127.0.0.1', r))
  const base = `http://127.0.0.1:${d.servidor.address().port}`
  // Sem derrubar as conexoes vivas, `close` nunca resolve com um SSE aberto --
  // e a suite trava em vez de falhar.
  const fechar = () =>
    new Promise((r) => {
      d.servidor.closeAllConnections()
      d.servidor.close(r)
    })
  return { base, fechar }
}

const hook = (over = {}) => JSON.stringify({
  session_id: 's1', cwd: '/repo', hook_event_name: 'PostToolUse',
  tool_name: 'Edit', tool_input: { file_path: 'a.ts' }, tool_response: { success: true }, ...over,
})

test('o daemon so escuta em loopback', async () => {
  const { base, fechar } = await subir()
  assert.ok(base.startsWith('http://127.0.0.1:'))
  await fechar()
})

test('ingestao aceita o hook e responde sem corpo', async () => {
  const { base, fechar } = await subir()
  const r = await fetch(`${base}/api/hook`, { method: 'POST', body: hook() })
  assert.equal(r.status, 204)
  await fechar()
})

test('payload invalido tambem responde ok: observar nunca derruba a sessao', async () => {
  const { base, fechar } = await subir()
  const r = await fetch(`${base}/api/hook`, { method: 'POST', body: 'isto nao e json' })
  assert.equal(r.status, 204, 'um hook que falha nao pode quebrar o trabalho de quem observa')
  await fechar()
})

test('o snapshot reflete o que foi ingerido', async () => {
  const { base, fechar } = await subir()
  await fetch(`${base}/api/hook`, { method: 'POST', body: hook({ hook_event_name: 'SessionStart' }) })
  await fetch(`${base}/api/hook`, { method: 'POST', body: hook() })
  const s = await (await fetch(`${base}/api/snapshot`)).json()
  assert.equal(s.sessoes.length, 1)
  assert.equal(s.contadores.eventos, 2)
  await fechar()
})

test('o SSE entrega o evento que chega depois da conexao aberta', async () => {
  const { base, fechar } = await subir()
  const ctrl = new AbortController()
  const r = await fetch(`${base}/api/stream`, { signal: ctrl.signal })
  assert.equal(r.headers.get('content-type'), 'text/event-stream')

  const leitor = r.body.getReader()
  const decoder = new TextDecoder()
  await fetch(`${base}/api/hook`, { method: 'POST', body: hook() })

  // O primeiro chunk e o comentario de conexao (`: conectado`), nao o evento --
  // ler so uma vez e testar o keep-alive, nao a entrega.
  let recebido = ''
  while (!recebido.includes('tool.post')) {
    const { value, done } = await leitor.read()
    if (done) break
    recebido += decoder.decode(value)
  }
  assert.match(recebido, /tool\.post/)
  assert.match(recebido, /a\.ts/, 'o evento precisa chegar inteiro, nao so o tipo')
  ctrl.abort()
  await fechar()
})

test('rota desconhecida devolve 404 em vez de vazar arquivo', async () => {
  const { base, fechar } = await subir()
  assert.equal((await fetch(`${base}/../../etc/passwd`)).status, 404)
  await fechar()
})

test('a tela e servida na raiz', async () => {
  const { base, fechar } = await subir()
  const r = await fetch(`${base}/`)
  assert.equal(r.status, 200)
  assert.match(r.headers.get('content-type'), /text\/html/)
  await fechar()
})
