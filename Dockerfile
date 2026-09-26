FROM node:22-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build
ENV BURNBRAKE_HOST=0.0.0.0
ENV BURNBRAKE_ALLOW_PUBLIC_BIND=1
ENV BURNBRAKE_PORT=8787
EXPOSE 8787
CMD ["node", "--disable-warning=ExperimentalWarning", "dist/cli.js", "serve"]
