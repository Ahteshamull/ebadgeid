FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
ARG NEXT_PUBLIC_API_BASE_URL
ARG NEXT_PUBLIC_UPLOAD_BASE_URL
ARG SAML_BACKEND_URL
ENV NEXT_PUBLIC_API_BASE_URL=$NEXT_PUBLIC_API_BASE_URL NEXT_PUBLIC_UPLOAD_BASE_URL=$NEXT_PUBLIC_UPLOAD_BASE_URL
# Server-only (not NEXT_PUBLIC_ -- never sent to the browser), but still
# has to be a build ARG, not just a runtime `environment:` on the compose
# service: next.config.mjs's rewrites() is resolved once during `next
# build` into routes-manifest.json, not re-evaluated per request or per
# container start the way it would be for a plain Node.js script -- a
# runtime-only env var here is silently ignored. Confirmed for real: a
# rewrite that read this from a runtime env var connected to
# 127.0.0.1:5000 (the code's own hardcoded fallback) even with the
# correct value present in `docker exec ... env` inside the running
# container.
ENV SAML_BACKEND_URL=$SAML_BACKEND_URL
ENV NEXT_TELEMETRY_DISABLED=1
# La imagen copia .next/standalone, asi que este build SI necesita esa
# salida. Fuera de Docker queda sin definir y el build resultante es uno
# normal, servible con 'next start' (ver next.config.mjs).
ENV NEXT_OUTPUT_STANDALONE=1
RUN npm run build
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=3000 NEXT_TELEMETRY_DISABLED=1
COPY --chown=node:node --from=build /app/.next/standalone ./
COPY --chown=node:node --from=build /app/.next/static ./.next/static
COPY --chown=node:node --from=build /app/public ./public
EXPOSE 3000
USER node
CMD ["node", "server.js"]
