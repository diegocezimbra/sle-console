/**
 * Mini-cliente CDP sobre o WebSocket nativo do Node.
 *
 * Existe para testar a interface num browser de verdade sem acrescentar uma
 * unica dependencia -- nem de runtime, nem de desenvolvimento. Sem Chrome na
 * maquina, o teste se declara pulado em vez de falhar.
 */
import { execFile, spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const CANDIDATOS = ['google-chrome', 'chromium', 'chromium-browser']

export async function acharChrome() {
  for (const nome of CANDIDATOS) {
    const caminho = await new Promise((r) =>
      execFile('which', [nome], (e, out) => r(e ? null : out.trim()))
    )
    if (caminho) return caminho
  }
  return null
}

export async function abrirBrowser() {
  const exe = await acharChrome()
  if (!exe) return null

  const perfil = mkdtempSync(join(tmpdir(), 'sle-chrome-'))
  const proc = spawn(exe, [
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    '--remote-debugging-port=0',
    `--user-data-dir=${perfil}`,
    'about:blank',
  ])

  const ws = new WebSocket(await esperarWsUrl(proc))
  await new Promise((ok, erro) => {
    ws.onopen = ok
    ws.onerror = () => erro(new Error('nao consegui falar com o Chrome'))
  })

  let proximoId = 0
  const pendentes = new Map()
  const erros = []      // excecoes de JavaScript e console.error
  const errosDeRede = [] // 4xx/5xx que a pagina pediu -- pode ser o esperado
  let sessao = null

  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data)
    if (msg.id != null) {
      const p = pendentes.get(msg.id)
      if (!p) return
      pendentes.delete(msg.id)
      return msg.error ? p.erro(new Error(msg.error.message)) : p.ok(msg.result)
    }
    if (msg.method === 'Runtime.exceptionThrown') {
      erros.push(msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text)
    }
    if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error') {
      // Um 422 de validacao e resposta esperada, nao defeito da pagina:
      // misturar os dois faz o teste de "sem erro de JS" mentir.
      const destino = msg.params.entry.source === 'network' ? errosDeRede : erros
      destino.push(msg.params.entry.text)
    }
  }

  const chamar = (method, params = {}) =>
    new Promise((ok, erro) => {
      const id = ++proximoId
      pendentes.set(id, { ok, erro })
      const env = { id, method, params }
      if (sessao) env.sessionId = sessao
      ws.send(JSON.stringify(env))
    })

  const { targetInfos } = await chamar('Target.getTargets')
  const pagina = targetInfos.find((t) => t.type === 'page')
  const anexo = await chamar('Target.attachToTarget', { targetId: pagina.targetId, flatten: true })
  sessao = anexo.sessionId

  await chamar('Runtime.enable')
  await chamar('Log.enable')
  await chamar('Page.enable')
  // Viewport explicita: sem isto a captura sai no tamanho padrao do headless.
  await chamar('Emulation.setDeviceMetricsOverride', {
    width: 1440, height: 800, deviceScaleFactor: 1, mobile: false,
  })

  const cliente = {
    erros,
    errosDeRede,
    async ir(url) {
      await chamar('Page.navigate', { url })
    },
    async avaliar(expressao) {
      const r = await chamar('Runtime.evaluate', {
        expression: `(async () => (${expressao}))()`,
        awaitPromise: true,
        returnByValue: true,
      })
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.text)
      return r.result.value
    },
    async esperar(expressao, { limite = 10000 } = {}) {
      const ate = Date.now() + limite
      let ultimo
      while (Date.now() < ate) {
        try {
          ultimo = await cliente.avaliar(expressao)
          if (ultimo) return true
        } catch {
          /* a pagina ainda pode estar carregando */
        }
        await new Promise((r) => setTimeout(r, 60))
      }
      throw new Error(`esperei ${limite}ms e continuou falso: ${expressao}`)
    },
    /** PNG da viewport, em base64 -- usado para inspecao visual. */
    async capturar() {
      const r = await chamar('Page.captureScreenshot', { format: 'png' })
      return Buffer.from(r.data, 'base64')
    },
    async fechar() {
      ws.close()
      proc.kill()
      try {
        rmSync(perfil, { recursive: true, force: true, maxRetries: 3 })
      } catch {
        /* o Chrome ainda pode estar soltando o perfil; nao e problema do teste */
      }
    },
  }
  return cliente
}

function esperarWsUrl(proc) {
  return new Promise((ok, erro) => {
    let buffer = ''
    const prazo = setTimeout(() => erro(new Error('Chrome nao anunciou a porta de depuracao')), 20000)
    proc.stderr.on('data', (c) => {
      buffer += c
      const m = buffer.match(/ws:\/\/\S+/)
      if (m) {
        clearTimeout(prazo)
        ok(m[0])
      }
    })
  })
}
