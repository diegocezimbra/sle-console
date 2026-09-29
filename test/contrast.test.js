import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

/**
 * CARD-094 (tema): claro e escuro seguem o sistema com contraste AA (4,5:1 para texto, 3:1 para foco e
 * elementos de interface). Le as variaveis dos proprios CSS, entao um tom novo que quebre o contraste
 * reprova aqui, sem depender de alguem abrir a tela nos dois temas.
 */
const css = (file) => readFileSync(new URL(`../web/${file}`, import.meta.url), 'utf8')

/** `--nome: #abc;` dentro de um bloco -> {nome: '#abc'} */
function vars(block) {
  return Object.fromEntries([...block.matchAll(/(--[\w-]+)\s*:\s*(#[0-9a-fA-F]{3,8})\s*(?:;|$)/gm)].map((m) => [m[1], m[2]]))
}
/** O 1o `:root{...}` e o tema escuro; o `:root{...}` dentro do @media (prefers-color-scheme: light) sobrescreve. */
function themes(text) {
  const dark = vars(/:root\s*\{([^}]*)\}/.exec(text)[1])
  const light = /@media \(prefers-color-scheme: light\)\s*\{\s*:root\s*\{([^}]*)\}/.exec(text)
  assert.ok(light, 'falta o bloco @media (prefers-color-scheme: light)')
  return { dark, light: { ...dark, ...vars(light[1]) } }
}

const channel = (c) => { const v = c / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 }
function luminance(hex) {
  let h = hex.slice(1)
  if (h.length === 3) h = [...h].map((x) => x + x).join('')
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16))
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}
const contrast = (a, b) => { const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05) }

function check(name, palette, pairs) {
  const failures = []
  for (const [fg, bg, min = 4.5] of pairs) {
    assert.ok(palette[fg], `${name}: variavel ${fg} nao definida`)
    assert.ok(palette[bg], `${name}: variavel ${bg} nao definida`)
    const ratio = contrast(palette[fg], palette[bg])
    if (ratio < min) failures.push(`${fg} ${palette[fg]} sobre ${bg} ${palette[bg]} = ${ratio.toFixed(2)} (minimo ${min})`)
  }
  assert.deepEqual(failures, [], `${name} abaixo de AA:\n${failures.join('\n')}`)
}

const SURFACES = ['--m-bg', '--m-surface', '--m-surface-2']
const MOBILE_PAIRS = [
  ...SURFACES.flatMap((s) => [['--m-text', s], ['--m-muted', s], ['--m-accent', s], ['--m-ok', s], ['--m-warn', s], ['--m-danger', s], ['--m-focus', s, 3]]),
  ['--m-accent-ink', '--m-accent'], // botao Enviar/Responder e selos
  ['--m-warn-ink', '--m-warn'], // aviso sem conexao e selo de pendentes
  ['--m-danger-ink', '--m-danger'], // risco alto
  ['--m-bg', '--m-muted'], // selo do Quadro
  ['--m-bg', '--m-text'], // aviso rapido (toast) e faixa de versao nova
]
const CHAT_PAIRS = [
  ...['--fundo', '--painel', '--diego', '--deus'].flatMap((s) => [['--texto', s], ['--fraco', s], ['--link', s]]),
  ['--link-ink', '--link'], // botao Enviar
  ['--erro', '--fundo'],
]
const PRIORITY_PAIRS = ['--pri-p-1', '--pri-p0', '--pri-p1', '--pri-p2', '--pri-p3'].map((p) => ['--pri-texto', p])

test('celular (mobile.css): tema escuro com contraste AA', () => check('mobile escuro', themes(css('mobile/mobile.css')).dark, MOBILE_PAIRS))
test('celular (mobile.css): tema claro com contraste AA', () => check('mobile claro', themes(css('mobile/mobile.css')).light, MOBILE_PAIRS))
test('chat (chat.css): tema escuro com contraste AA', () => check('chat escuro', themes(css('chat.css')).dark, CHAT_PAIRS))
test('chat (chat.css): tema claro com contraste AA', () => check('chat claro', themes(css('chat.css')).light, CHAT_PAIRS))
test('etiquetas de prioridade (branco sobre cada P) com contraste AA nos dois temas', () => {
  const palette = vars(/:root\s*\{([^}]*)\}/.exec(css('style.css'))[1])
  check('prioridades', palette, PRIORITY_PAIRS)
})
test('as paginas declaram os dois temas (color-scheme e theme-color claro/escuro)', () => {
  for (const file of ['index.html', 'chat.html']) {
    const html = css(file)
    assert.match(html, /name="color-scheme" content="dark light"/, file)
    assert.match(html, /name="theme-color"[^>]*prefers-color-scheme: dark/, file)
    assert.match(html, /name="theme-color"[^>]*prefers-color-scheme: light/, file)
  }
})
