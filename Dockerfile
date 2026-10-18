# Skyloom web server (login + batch UI) for Railway. Build context is the repo root.
FROM node:22-slim AS build
WORKDIR /repo
# The app depends on skyloom-core through a file: link, and bundles it, so copy the core first.
COPY skyloom-core skyloom-core
COPY skyloom-app/package.json skyloom-app/package-lock.json skyloom-app/
# The desktop shell's Electron binary is not needed to build the web server.
ENV ELECTRON_SKIP_BINARY_DOWNLOAD=1
RUN cd skyloom-app && npm ci
COPY skyloom-app skyloom-app
RUN cd skyloom-app && npm run build:web

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production \
    DATA_DIR=/data \
    STATIC_DIR=/app/dist/renderer
COPY --from=build /repo/skyloom-app/dist/server dist/server
COPY --from=build /repo/skyloom-app/dist/renderer dist/renderer
# Railway mounts volumes owned by root, so the process runs as root inside the container (no extra privileges, no shell access from outside).
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/server/main.cjs"]
