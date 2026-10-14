# --- build the web app ---
FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY scripts ./scripts
RUN npm ci
COPY . .
RUN npm run build

# --- run: one process serves the app and the API ---
FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=8787 UNIHUB_DATA=/data
# the server needs only hono, @hono/node-server and zod (node:sqlite is built in) — not the browser-side libraries
COPY server ./server
RUN cd server && npm install --omit=dev --no-audit --no-fund && npm cache clean --force
COPY --from=build /app/dist ./dist
# the data directory must be writable by the unprivileged user before it becomes a volume
RUN mkdir -p /data && chown node:node /data
VOLUME /data
EXPOSE 8787
USER node
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://localhost:8787/api/health || exit 1
CMD ["node", "server/index.ts"]
