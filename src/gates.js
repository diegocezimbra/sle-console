/**
 * O motor de gates: quem decide o que acontece com o resultado da verificacao.
 *
 * Duas regras que valem para todos os modos: **falha fechada, nunca aberta** --
 * gate que o daemon nao consegue avaliar para o pipeline em vez de liberar; e
 * **reprovar sempre carrega o motivo**, porque devolver ao agente um "tente de
 * novo" sem a saida e mandar ele adivinhar.
 */
import { testarComando } from './verificacao.js'

export async function decidirGate(projeto, gate, card) {
  const modo = gate.mode

  if (modo === 'human') {
    return { gate: gate.id, decisao: 'aguardando_humano', motivo: null }
  }

  if (modo === 'auto_unless' && condicaoBate(gate.condition, card)) {
    return { gate: gate.id, decisao: 'aguardando_humano', motivo: `condição: ${gate.condition}` }
  }

  if (!gate.verify) {
    return { gate: gate.id, decisao: 'invalido', motivo: 'gate automático sem "verify"' }
  }
  if (gate.verify.type !== 'command') {
    return {
      gate: gate.id,
      decisao: 'invalido',
      motivo: `tipo de verificação não suportado: "${gate.verify.type}"`,
    }
  }

  const r = await testarComando(projeto, gate.verify.run)
  const passou = atendeu(gate.verify.expect, r.exit)
  const resultado = passou ? 'passou' : 'reprovou'

  // Advisory roda, registra e nao bloqueia -- e como se roda gate novo antes
  // de confiar nele.
  if (modo === 'advisory') {
    return { gate: gate.id, decisao: 'passou', observacao: resultado, motivo: r.saida }
  }
  return { gate: gate.id, decisao: resultado, motivo: passou ? null : r.saida }
}

/** `exit == 0` por padrao; `exit != 0` para a etapa de teste vermelho. */
function atendeu(expect, exit) {
  if (!expect || /exit\s*==\s*0/.test(expect)) return exit === 0
  if (/exit\s*!=\s*0/.test(expect)) return exit !== 0
  return false
}

/**
 * Só o formato `card.<campo> == '<valor>'` e reconhecido.
 *
 * Deliberadamente burro: avaliar a condicao como expressao seria executar,
 * dentro do daemon, texto vindo de um arquivo de configuracao editavel pela UI.
 * O que nao casa o formato nao e avaliado -- e ignorado.
 */
function condicaoBate(condicao, card) {
  if (!condicao) return false
  const m = /^\s*card\.(\w+)\s*==\s*'([^']*)'\s*$/.exec(condicao)
  if (!m) return false
  return String(card?.[m[1]] ?? '') === m[2]
}
