// Markdown do corpo do card, escapado antes de qualquer marca (o texto do card nunca vira HTML).
// Compartilhado pelo modal do desktop (app.js) e pela tela de card do celular (mobile/card.js).

export function inline(s) {
  return s.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/`([^`]+)`/g, '<code>$1</code>')
}

/** Escapa e converte um subconjunto simples de markdown -- títulos, listas,
 *  negrito, código inline. `## Opções` vira cartões clicáveis (A/B/C…), e
 *  esses cartões mais "decidir"/"recomendação" ficam num bloco em destaque:
 *  é a única pergunta que o Diego veio ao modal para responder. */
export function markdownSeguro(texto) {
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const linhas = esc(texto).split('\n')
  const html = []
  let listaAberta = false
  let opcoesAbertas = false
  let decisaoAberta = false
  let emSecaoOpcoes = false

  const fecharLista = () => { if (listaAberta) { html.push('</ul>'); listaAberta = false } }
  const fecharOpcoes = () => { if (opcoesAbertas) { html.push('</div>'); opcoesAbertas = false } }

  for (const linha of linhas) {
    const titulo = /^(#{1,6})\s+(.*)$/.exec(linha)
    // O card real escreve "- A: texto" (lista com dois-pontos), não "A) texto".
    const itemOpcao = emSecaoOpcoes && /^-?\s*([A-Z])[):]\s*(.*)$/.exec(linha)
    const item = !itemOpcao && /^[-*]\s+(.*)$/.exec(linha)

    if (titulo) {
      fecharLista()
      fecharOpcoes()
      const textoTitulo = titulo[2]
      const ehDecisao = /decidir|op[cç][aã]o|op[cç][ãõo]es|recomenda/i.test(textoTitulo)
      if (ehDecisao && !decisaoAberta) { html.push('<div class="bloco-decisao">'); decisaoAberta = true }
      else if (!ehDecisao && decisaoAberta) { html.push('</div>'); decisaoAberta = false }
      emSecaoOpcoes = /op[cç][ãõo]es/i.test(textoTitulo)
      const n = Math.min(titulo[1].length + 1, 6)
      html.push(`<h${n}>${inline(textoTitulo)}</h${n}>`)
      continue
    }
    if (itemOpcao) {
      if (!opcoesAbertas) { html.push('<div class="cartoes-opcao">'); opcoesAbertas = true }
      const rotulo = `${itemOpcao[1]}) ${itemOpcao[2]}`
      html.push(`<button type="button" class="cartao-opcao" data-opcao="${rotulo.replace(/"/g, '&quot;')}">${inline(rotulo)}</button>`)
      continue
    }
    fecharOpcoes()
    if (item) {
      if (!listaAberta) { html.push('<ul>'); listaAberta = true }
      html.push(`<li>${inline(item[1])}</li>`)
      continue
    }
    fecharLista()
    if (linha.trim() === '') continue
    html.push(`<p>${inline(linha)}</p>`)
  }
  fecharLista()
  fecharOpcoes()
  if (decisaoAberta) html.push('</div>')
  return html.join('\n')
}

/** A seção "Credenciais necessárias" NUNCA é renderizada como texto livre (alguém pode ter colado um valor):
 *  o painel dedicado abaixo mostra só nome + status. */
export function semSecaoDeCredenciais(corpo) {
  return corpo.replace(/^## Credenciais necessárias[^\n]*\n[\s\S]*?(?=^## |(?![\s\S]))/m, '')
}
