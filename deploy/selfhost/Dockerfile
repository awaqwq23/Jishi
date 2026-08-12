FROM node:22-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY . .
RUN npm run build
RUN chmod +x /app/deploy/selfhost/start.sh
EXPOSE 3000
CMD ["/app/deploy/selfhost/start.sh"]
