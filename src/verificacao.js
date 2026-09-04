/**
 * O "testar agora" do editor de gates.
 *
 * Gate cuja condicao voce nunca viu executar e gate que voce nao sabe se
 * funciona -- por isso o botao existe. E por isso o comando roda de verdade,
 * no projeto, com limite de tempo e de saida: um gate mal escrito nao pode
 * pendurar nem encher o daemon.
 */
import { spawn } from 'node:child_process'

export function testarComando(projeto, comando, { limite = 120000, maximo = 200000 } = {}) {
  if (!comando?.trim()) {
    return Promise.resolve({ ok: false, exit: null, saida: 'comando vazio', ms: 0, expirou: false })
  }

  return new Promise((resolver) => {
    const inicio = Date.now()
    const proc = spawn('/bin/sh', ['-c', comando], { cwd: projeto })
    let saida = ''
    let expirou = false

    const juntar = (pedaco) => {
      if (saida.length < maximo) saida += pedaco
    }
    proc.stdout.on('data', juntar)
    proc.stderr.on('data', juntar)

    const prazo = setTimeout(() => {
      expirou = true
      proc.kill('SIGKILL')
    }, limite)

    proc.on('close', (code) => {
      clearTimeout(prazo)
      if (saida.length >= maximo) saida = saida.slice(0, maximo) + '\n… saida truncada'
      if (expirou) saida += `\n… interrompido: passou do limite de ${limite}ms`
      resolver({
        ok: !expirou && code === 0,
        exit: expirou ? null : code,
        saida,
        ms: Date.now() - inicio,
        expirou,
      })
    })

    proc.on('error', (e) => {
      clearTimeout(prazo)
      resolver({ ok: false, exit: null, saida: e.message, ms: Date.now() - inicio, expirou: false })
    })
  })
}
