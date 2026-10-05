# syntax=docker/dockerfile:1
# Imagem única: serve a API, o painel web (mesmo domínio) e, opcionalmente, o worker.
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY web/package.json web/
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
RUN npm ci
COPY shared shared
COPY server server
COPY web web
RUN npm run build --workspace web && npm run build --workspace server

FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci --omit=dev --workspace server --include-workspace-root=false

FROM node:22-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app/server
COPY --from=deps /app/node_modules /app/node_modules
COPY --from=build /app/server/package.json ./package.json
COPY --from=build /app/server/dist ./dist
COPY --from=build /app/server/drizzle ./drizzle
COPY --from=build /app/web/dist ./public
USER node
EXPOSE 3333
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3333)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
# As migrações rodam ao iniciar (MIGRATE_ON_START=false para desativar).
CMD ["node", "dist/index.js"]
