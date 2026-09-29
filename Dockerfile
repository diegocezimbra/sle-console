# sle-console em CONSOLE_MODE=git (CARD-096): imagem mínima, sem privilégio
# de root, com git+ssh pra clonar/sincronizar o repo de cards fora da
# máquina do DEUS.
FROM node:22-alpine

# git: clone/pull/commit/push do modo CONSOLE_MODE=git.
# openssh-client: a deploy key fala com o GitHub por ssh, não https.
# age: criptografa as credenciais de teste com a chave pública do DEUS (CARD-202).
# curl: só pro HEALTHCHECK -- alpine não traz nenhum dos dois por padrão.
RUN apk add --no-cache git openssh-client curl age

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

COPY bin ./bin
COPY src ./src
COPY web ./web

# /data é onde vivem o clone do repo de dados, a chave de deploy e os
# eventos do daemon -- tudo que precisa sobreviver a um redeploy some daqui,
# nunca de dentro de /app (que a imagem reconstrói do zero a cada build).
ENV SLE_INSTALACAO=/data
RUN mkdir -p /data && addgroup -S console && adduser -S console -G console \
  && chown -R console:console /app /data
USER console

EXPOSE 7717

# Sem `-f`: o objetivo é "o processo responde", não "responde sem
# credencial" -- com CONSOLE_USER/CONSOLE_PASSWORD setados, /api/health
# ainda devolve 200 (auth.js deixa `/api/health` de fora de propósito), mas
# mesmo se algum dia exigir auth, `curl` sem `-f` só falha em erro de rede,
# não em 401/403 (curl -f já matou HEALTHCHECK por 403 antes).
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -s -o /dev/null http://127.0.0.1:7717/api/health || exit 1

CMD ["node", "bin/sle.js"]
