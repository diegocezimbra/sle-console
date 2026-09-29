// Markdown minimo do chat: negrito, italico, codigo, blocos de codigo, listas e links.
// Escapa TUDO primeiro e so depois reintroduz as marcas -- o texto do chat nunca vira HTML.
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }
export const esc = (t) => String(t).replace(/[&<>"']/g, (c) => ESC[c])

function inline(linha) {
  let s = esc(linha)
  const codigos = []
  s = s.replace(/`([^`\n]+)`/g, (_, c) => `\u0000${codigos.push(`<code>${c}</code>`) - 1}\u0000`)
  s = s.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
  s = s.replace(/(^|[\s(])\*([^*\n]+)\*(?=$|[\s).,;:!?])/g, '$1<em>$2</em>')
  s = s.replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
  s = s.replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, '$1<a href="$2" target="_blank" rel="noopener noreferrer">$2</a>')
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => codigos[Number(i)])
}

export function renderMarkdown(texto) {
  const saida = []
  const linhas = String(texto).replace(/\r\n?/g, '\n').split('\n')
  let lista = null
  let bloco = null
  let paragrafo = []
  const fechaParagrafo = () => {
    if (paragrafo.length) saida.push(`<p>${paragrafo.map(inline).join('<br>')}</p>`)
    paragrafo = []
  }
  const fechaLista = () => {
    if (lista) saida.push(`<${lista.tag}>${lista.itens.map((i) => `<li>${inline(i)}</li>`).join('')}</${lista.tag}>`)
    lista = null
  }
  for (const linha of linhas) {
    if (bloco) {
      if (/^```/.test(linha)) {
        saida.push(`<pre><code>${esc(bloco.join('\n'))}</code></pre>`)
        bloco = null
      } else bloco.push(linha)
      continue
    }
    if (/^```/.test(linha)) {
      fechaParagrafo()
      fechaLista()
      bloco = []
      continue
    }
    const item = /^\s*(?:[-*]|(\d+)[.)])\s+(.*)$/.exec(linha)
    if (item) {
      fechaParagrafo()
      const tag = item[1] ? 'ol' : 'ul'
      if (lista && lista.tag !== tag) fechaLista()
      lista ??= { tag, itens: [] }
      lista.itens.push(item[2])
      continue
    }
    fechaLista()
    if (!linha.trim()) fechaParagrafo()
    else paragrafo.push(linha)
  }
  if (bloco) saida.push(`<pre><code>${esc(bloco.join('\n'))}</code></pre>`)
  fechaParagrafo()
  fechaLista()
  return saida.join('')
}
