FROM node:22-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --ignore-scripts --no-audit --no-fund
COPY . .
RUN chmod +x /app/deploy/selfhost/start.sh
EXPOSE 8787
CMD ["/app/deploy/selfhost/start.sh"]
