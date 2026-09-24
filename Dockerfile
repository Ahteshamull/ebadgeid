FROM node:22-alpine
WORKDIR /app

RUN apk add --no-cache libxml2-utils

# Copy package specifications
COPY ["backend (updated)/package.json", "backend (updated)/package-lock.json", "./"]
RUN npm ci --omit=dev

# Copy backend source code
COPY --chown=node:node ["backend (updated)/", "./"]

RUN mkdir -p /app/uploads /app/backups /app/private-contracts && chown -R node:node /app/uploads /app/backups /app/private-contracts

ENV NODE_ENV=development
EXPOSE 5000

USER node

CMD ["node", "api.js"]
