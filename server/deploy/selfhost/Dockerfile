FROM node:24-bookworm-slim
WORKDIR /app
COPY . .
RUN npm ci --workspace @jishi/server --include-workspace-root --ignore-scripts --no-audit --no-fund
RUN chmod +x /app/server/deploy/selfhost/start.sh
WORKDIR /app/server
EXPOSE 8787
CMD ["/app/server/deploy/selfhost/start.sh"]
