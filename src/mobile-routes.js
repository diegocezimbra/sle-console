/**
 * API enxuta do celular (CARD-094), fora do daemon.js para nao crescer o
 * arquivo que outros cards tambem editam.
 *
 *   GET /api/cards?summary=1   o board sem corpo de card (+ a pergunta dos pendentes)
 *   GET /api/search?q=...      busca em id, titulo, projeto e corpo
 *
 * As duas respostas levam ETag: o celular repete a consulta a cada poucos
 * segundos, e o servidor responde 304 sem corpo enquanto nada mudou.
 */
import { createHash } from 'node:crypto'

import { searchCards, summarizeIndex } from './summary.js'

/** JSON com ETag fraco derivado do conteudo; `If-None-Match` igual vira 304. */
export function sendJsonWithEtag(req, res, data) {
  const body = JSON.stringify(data)
  const etag = `W/"${createHash('sha1').update(body).digest('base64url').slice(0, 22)}"`
  if (req.headers['if-none-match'] === etag) {
    res.writeHead(304, { etag, 'cache-control': 'no-cache' })
    return res.end()
  }
  res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', etag, 'cache-control': 'no-cache' })
  return res.end(body)
}

/** Devolve `(req, res, rota, indice) => boolean` (true = tratou); `indice()` e o indice do projeto pedido na requisicao. */
export function createMobileRoutes() {
  return function handle(req, res, rota, indice) {
    if (req.method !== 'GET') return false
    const query = new URL(req.url, 'http://x').searchParams
    if (rota === '/api/cards' && query.get('summary') === '1') {
      sendJsonWithEtag(req, res, summarizeIndex(indice()))
      return true
    }
    if (rota === '/api/search') {
      sendJsonWithEtag(req, res, { results: searchCards(indice().cards, query.get('q') ?? '') })
      return true
    }
    return false
  }
}
