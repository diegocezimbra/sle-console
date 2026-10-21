/**
 * O "testar agora" do editor de gates.
 *
 * Gate cuja condicao voce nunca viu executar e gate que voce nao sabe se
 * funciona -- por isso o botao existe. E por isso o comando roda de verdade,
 * no projeto, com limite de tempo e de saida: um gate mal escrito nao pode
 * pendurar nem encher o daemon.
 */
import { runCommand } from './run-command.js'

export function testarComando(projeto, comando, { limite = 120000, maximo = 200000 } = {}) {
  if (!comando?.trim()) {
    return Promise.resolve({ ok: false, exit: null, saida: 'comando vazio', ms: 0, expirou: false })
  }

  // A sintaxe dos gates admite pipe/redirecionamento, por isso o shell fixo
  // recebe o comando inteiro como um único argumento. Não há interpolação de
  // valores externos no script: a chamada autenticada ou pipeline.json define
  // o próprio comando, e cwd/limites nunca entram no texto avaliado.
  return runCommand('/bin/sh', ['-c', comando], { cwd: projeto, timeoutMs: limite, maxBuffer: maximo })
    .then((r) => {
      let saida = `${r.stdout}${r.stderr}`
      if (r.overflowed) saida = saida.slice(0, maximo) + '\n… saida truncada'
      if (r.timedOut) saida += `\n… interrompido: passou do limite de ${limite}ms`
      return {
        ok: r.ok,
        exit: r.timedOut ? null : r.code,
        saida,
        ms: r.ms,
        expirou: r.timedOut,
      }
    })
}
