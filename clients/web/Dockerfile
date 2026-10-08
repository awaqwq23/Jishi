FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY . .
RUN npm ci --workspace @jishi/web --include-workspace-root --ignore-scripts --no-audit --no-fund
RUN npm run build:web
FROM node:24-bookworm-slim
WORKDIR /app
COPY --from=build /app/clients/web/dist ./dist
COPY --from=build /app/clients/web/server.mjs ./server.mjs
EXPOSE 3000
CMD ["node", "server.mjs", "--hostname", "0.0.0.0"]
