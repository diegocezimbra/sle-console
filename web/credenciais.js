// CARD-202: formulário de credenciais de teste no card. O valor sai do <input type=password> direto para o PUT e o
// campo é limpo na hora; a tela só mostra nome + status — nunca há valor para exibir.
const ROTULO = { ausente: 'ausente', enviada: 'enviada — aguardando o DEUS', preenchida: 'preenchida' }

function linhaDaChave({ name, status }, aoSalvar) {
  const li = document.createElement('li')
  li.className = `cred-linha cred-${status}`
  const nome = document.createElement('code')
  nome.textContent = name
  const selo = document.createElement('span')
  selo.className = 'cred-status'
  selo.textContent = ROTULO[status] ?? status
  li.append(nome, selo)
  if (status === 'preenchida') return li

  const form = document.createElement('form')
  form.className = 'cred-form'
  const campo = document.createElement('input')
  campo.type = 'password'
  campo.className = 'cred-valor'
  campo.setAttribute('aria-label', `valor de ${name}`)
  campo.placeholder = 'valor (não fica visível depois de salvo)'
  campo.autocomplete = 'new-password'
  campo.spellcheck = false
  const botao = document.createElement('button')
  botao.type = 'submit'
  botao.className = 'botao-secundario'
  botao.textContent = status === 'enviada' ? 'Reenviar' : 'Salvar credencial'
  const msg = document.createElement('span')
  msg.className = 'cred-msg'
  form.append(campo, botao, msg)
  form.addEventListener('submit', async (e) => {
    e.preventDefault()
    const value = campo.value
    if (!value) return
    botao.disabled = true
    try {
      const r = await fetch(`/api/credentials/${encodeURIComponent(name)}`, { method: 'PUT', body: JSON.stringify({ value }) })
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).erro ?? `erro ${r.status}`)
      campo.value = ''
      await aoSalvar()
    } catch (err) {
      msg.textContent = err.message
      botao.disabled = false
    }
  })
  li.append(form)
  return li
}

/** Preenche `#modal-cred-form` para o card aberto; sem seção de credenciais no card, esconde o bloco. */
export async function pintarCredenciais(id, alvo, comProjeto = (u) => u) {
  alvo.hidden = true
  alvo.replaceChildren()
  let lista = []
  try {
    const r = await fetch(comProjeto(`/api/cards/${encodeURIComponent(id)}/credentials`))
    if (r.ok) lista = (await r.json()).credentials ?? []
  } catch {
    return
  }
  if (!lista.length) return
  const titulo = document.createElement('h3')
  titulo.textContent = 'Enviar credencial de teste'
  const ul = document.createElement('ul')
  ul.className = 'cred-lista'
  const recarregar = () => pintarCredenciais(id, alvo, comProjeto)
  for (const c of lista) ul.append(linhaDaChave(c, recarregar))
  alvo.append(titulo, ul)
  alvo.hidden = false
}
