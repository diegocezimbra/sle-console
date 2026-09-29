// Teclado aberto: no iOS o teclado nao encolhe o layout, so a "visual viewport". Uma camada
// `position: fixed` com rodape (o botao Responder, o campo do chat) ficaria escondida atras dele.
// Esta funcao a mantem exatamente sobre a area visivel. Onde o teclado ja redimensiona o layout
// (Chrome Android com `interactive-widget=resizes-content`) nao muda nada.

/** Devolve a funcao que desliga o ajuste. */
export function fitToVisualViewport(el) {
  const vv = window.visualViewport
  if (!vv) return () => {}
  const apply = () => {
    const shrunk = window.innerHeight - vv.height > 1
    el.style.top = shrunk ? `${vv.offsetTop}px` : ''
    el.style.height = shrunk ? `${vv.height}px` : ''
    el.style.bottom = shrunk ? 'auto' : ''
  }
  vv.addEventListener('resize', apply)
  vv.addEventListener('scroll', apply)
  apply()
  return () => {
    vv.removeEventListener('resize', apply)
    vv.removeEventListener('scroll', apply)
    el.style.top = el.style.height = el.style.bottom = ''
  }
}
