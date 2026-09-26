FROM node:22-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build
# Image default matches the freeze: listen on 127.0.0.1. Compose opts into
# 0.0.0.0 inside the container and publishes 127.0.0.1 on the host.
ENV BURNBRAKE_PORT=8787
EXPOSE 8787
CMD ["node", "--disable-warning=ExperimentalWarning", "dist/cli.js", "serve"]
