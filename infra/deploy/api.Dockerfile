# Imagem única para os processos http, worker e migrate (o comando muda por serviço no PaaS):
#   http:    node dist/main.js
#   worker:  node dist/worker.js
#   migrate: node dist/db/migrate.js   (release job, antes do rollout)
# Build a partir da raiz do monorepo:  docker build -f infra/deploy/api.Dockerfile .

FROM node:22-alpine AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN npm install -g pnpm@12.10.1

FROM base AS build
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm turbo run build --filter=@f4d/api...
# Bundle autocontido só com as dependências de produção da API.
RUN pnpm --filter=@f4d/api deploy --prod /out

FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
RUN addgroup -S app && adduser -S app -G app
COPY --from=build --chown=app:app /out ./
COPY --from=build --chown=app:app /repo/apps/api/dist ./dist
COPY --from=build --chown=app:app /repo/apps/api/src/db/migrations ./src/db/migrations
USER app
EXPOSE 3333
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:3333/v1/health || exit 1
CMD ["node", "dist/main.js"]
