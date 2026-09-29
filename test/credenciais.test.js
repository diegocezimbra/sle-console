import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { criarDaemon } from '../src/daemon.js'
import { chavesDoCard, statusDasChaves } from '../src/credenciais.js'

const SEGREDO = 'S3gredo-de-teste-#42'
let base, fechar, projeto, dirAge, tmp, chavePrivada

before(async () => {
  tmp = mkdtempSync(join(tmpdir(), 'sle-cred-'))
  chavePrivada = join(tmp, 'k')
  spawnSync('age-keygen', ['-o', chavePrivada])
  const publica = spawnSync('age-keygen', ['-y', chavePrivada], { encoding: 'utf8' }).stdout.trim()
  projeto = join(tmp, 'repo')
  mkdirSync(join(projeto, 'estado-publico'), { recursive: true })
  mkdirSync(join(projeto, 'cards', 'review'), { recursive: true })
  writeFileSync(join(projeto, 'estado-publico', 'age-recipient.txt'), publica + '\n')
  writeFileSync(
    join(projeto, 'cards', 'review', 'CARD-7.md'),
    '---\nid: CARD-7\ntitle: X\nstatus: review\n---\n## Como testar\n1. abrir\n\n## Credenciais necessárias\n\n- CENVIA_PROD_LOGIN — status: ausente\n- META_TEST_ACCOUNT — status: preenchida\n- _NENHUMA_ — status: preenchida\n\n## Notas\n- NAO_E_CHAVE\n'
  )
  dirAge = join(tmp, 'credenciais')
  const d = criarDaemon({ dados: join(tmp, 'dados', 'console'), projeto, credenciaisDir: dirAge })
  await new Promise((r) => d.servidor.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${d.servidor.address().port}`
  fechar = () => new Promise((r) => (d.observador.parar(), d.servidor.closeAllConnections(), d.servidor.close(r)))
})
after(async () => { await fechar?.() })

const salvar = (nome, value) => fetch(`${base}/api/credentials/${nome}`, { method: 'PUT', body: JSON.stringify({ value }) })

test('chavesDoCard lê só a seção de credenciais, ignora placeholder e outras seções', () => {
  const corpo = readFileSync(join(projeto, 'cards', 'review', 'CARD-7.md'), 'utf8')
  assert.deepEqual(chavesDoCard(corpo), [
    { name: 'CENVIA_PROD_LOGIN', declared: 'ausente' },
    { name: 'META_TEST_ACCOUNT', declared: 'preenchida' },
  ])
})

test('GET do card devolve nome+status e nenhum valor', async () => {
  const r = await fetch(`${base}/api/cards/CARD-7/credentials`)
  assert.equal(r.status, 200)
  assert.deepEqual((await r.json()).credentials, [
    { name: 'CENVIA_PROD_LOGIN', status: 'ausente' },
    { name: 'META_TEST_ACCOUNT', status: 'preenchida' },
  ])
})

test('salvar grava só .age (0600), criptografado, decriptável pela chave privada, sem texto puro no disco', async () => {
  const r = await salvar('CENVIA_PROD_LOGIN', SEGREDO)
  assert.equal(r.status, 200)
  const corpoResposta = await r.text()
  assert.ok(!corpoResposta.includes(SEGREDO))
  assert.deepEqual(readdirSync(dirAge), ['CENVIA_PROD_LOGIN.age'])
  const arq = join(dirAge, 'CENVIA_PROD_LOGIN.age')
  assert.equal(statSync(arq).mode & 0o777, 0o600)
  const bruto = readFileSync(arq)
  assert.ok(!bruto.includes(SEGREDO))
  const claro = spawnSync('age', ['-d', '-i', chavePrivada, arq], { encoding: 'utf8' })
  assert.equal(claro.stdout, SEGREDO)
})

test('depois de salvar a API mostra status enviada e continua sem devolver valor', async () => {
  const r = await fetch(`${base}/api/cards/CARD-7/credentials`)
  const texto = await r.text()
  assert.ok(!texto.includes(SEGREDO))
  assert.equal(JSON.parse(texto).credentials[0].status, 'enviada')
})

test('nenhuma rota devolve o conteúdo do .age nem o valor', async () => {
  for (const rota of ['/api/credentials/CENVIA_PROD_LOGIN', '/credenciais/CENVIA_PROD_LOGIN.age', '/api/file?path=../credenciais/CENVIA_PROD_LOGIN.age']) {
    const r = await fetch(`${base}${rota}`)
    const t = await r.text()
    assert.ok(!t.includes(SEGREDO) && !t.includes('age-encryption.org'), rota)
  }
})

test('nome inválido, valor vazio e valor enorme são recusados com 422 e nada é gravado', async () => {
  assert.equal((await salvar('minuscula', 'x')).status, 422)
  assert.equal((await salvar('OK_NOME', '')).status, 422)
  assert.equal((await salvar('OK_NOME', 'x'.repeat(70_000))).status, 422)
  assert.deepEqual(readdirSync(dirAge), ['CENVIA_PROD_LOGIN.age'])
})

test('sem chave pública do DEUS: 503 e nada gravado', () => {
  const vazio = mkdtempSync(join(tmpdir(), 'sle-cred-sem-'))
  const r = spawnSync('node', ['-e', `
    import('${join(process.cwd(), 'src/credenciais.js')}').then(m => {
      const r = m.salvarCredencial({ dirAge: '${vazio}/c', destinatario: null, nome: 'ABC_DEF', valor: 'x' })
      console.log(JSON.stringify(r))
    })`], { encoding: 'utf8' })
  assert.equal(JSON.parse(r.stdout).codigo, 503)
  assert.deepEqual(readdirSync(vazio), [])
})

test('status publicado pelo DEUS (credenciais.json) vale quando não há .age pendente', () => {
  writeFileSync(join(projeto, 'estado-publico', 'credenciais.json'), JSON.stringify({ CENVIA_PROD_LOGIN: 'preenchida' }))
  const s = statusDasChaves({ chaves: [{ name: 'CENVIA_PROD_LOGIN', declared: 'ausente' }], dirAge: join(tmp, 'nada'), raizPublica: projeto })
  assert.equal(s[0].status, 'preenchida')
})

test('a tela serve o módulo do formulário e o card abre o bloco de credenciais', async () => {
  const js = await (await fetch(`${base}/credenciais.js`)).text()
  assert.match(js, /export async function pintarCredenciais/)
  assert.match(await (await fetch(`${base}/app.js`)).text(), /pintarCredenciais\(c\.id/)
  assert.match(await (await fetch(`${base}/`)).text(), /id="modal-credenciais"/)
})
