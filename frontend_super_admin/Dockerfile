FROM node:22-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
# react-day-picker was bumped 8.10.1 -> 9.14.0 (React 19-compatible; the
# 8.x line only declared peer support up to React 18) and the lockfile
# regenerated from a clean `npm install`, so `npm ci` now resolves without
# --legacy-peer-deps. calendar.jsx/date-picker.jsx were updated for v9's
# API (Chevron component instead of IconLeft/IconRight, disabled={{before}}
# instead of the removed fromDate prop).
RUN npm ci

COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
# La imagen copia .next/standalone, asi que este build SI necesita esa
# salida. Fuera de Docker queda sin definir y el build resultante es uno
# normal, servible con 'next start' (ver next.config.mjs).
ENV NEXT_OUTPUT_STANDALONE=1
ARG NEXT_PUBLIC_API_BASE_URL
ARG NEXT_PUBLIC_STORAGE_API_URL
ARG NEXT_PUBLIC_SUPER_ADMIN_URL
ENV NEXT_PUBLIC_API_BASE_URL=$NEXT_PUBLIC_API_BASE_URL
ENV NEXT_PUBLIC_STORAGE_API_URL=$NEXT_PUBLIC_STORAGE_API_URL
ENV NEXT_PUBLIC_SUPER_ADMIN_URL=$NEXT_PUBLIC_SUPER_ADMIN_URL
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
