/**
 * Observa as pastas versionadas e avisa quando o disco muda.
 *
 * Editar um card no seu editor tem de refletir na tela; e o outro lado da
 * regra "o disco e a verdade". Rajada de escrita vira um aviso so, senao
 * salvar um arquivo grande recarrega a tela varias vezes.
 */
import { watch } from 'node:fs'
import { join, relative } from 'node:path'

export function observarArvore(raiz, pastas = ['cards', 'sle', 'docs'], { espera = 120 } = {}) {
  const ouvintes = new Set()
  const observadores = []
  let agendado = null
  let ultimo = null

  for (const pasta of pastas) {
    try {
      observadores.push(
        watch(join(raiz, pasta), { recursive: true }, (_tipo, nome) => {
          if (!nome) return
          ultimo = { caminho: relative(raiz, join(raiz, pasta, nome)), em: new Date().toISOString() }
          clearTimeout(agendado)
          agendado = setTimeout(disparar, espera)
        })
      )
    } catch {
      // Pasta que ainda nao existe nao e erro: o projeto pode nao ter `docs/`.
    }
  }

  function disparar() {
    for (const o of ouvintes) o(ultimo)
  }

  return {
    aoMudar: (fn) => ouvintes.add(fn),
    parar() {
      clearTimeout(agendado)
      for (const o of observadores) o.close()
      ouvintes.clear()
    },
  }
}
