FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --chown=node:node . .
ENV NODE_ENV=production PORT=8000
EXPOSE 8000
USER node
CMD ["node", "api.js"]
