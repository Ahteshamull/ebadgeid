FROM node:22-alpine
WORKDIR /app

RUN apk add --no-cache libxml2-utils

# Copy package specifications
COPY ["backend (updated)/package.json", "backend (updated)/package-lock.json", "./"]
RUN npm ci --omit=dev

# Copy backend source code
COPY --chown=node:node ["backend (updated)/", "./"]

RUN mkdir -p /app/uploads /app/backups /app/private-contracts && chown -R node:node /app/uploads /app/backups /app/private-contracts

ENV NODE_ENV=development \
    MONGO_URI=mongodb+srv://elena:elena@elena.1igq06i.mongodb.net/ebadgeid?retryWrites=true&w=majority&appName=elena \
    JWT_SECRET=c8d9e72847a61d5f309b5c28e932b145a8f4c719e2304918237d45a9b1c78e90 \
    HELPDESK_JWT_SECRET=d9e0f12958b72e6041ac6d39fa43c256b905d820f3415029348e56bac2d89fa1 \
    ENCRYPTION_SECRET=a1b2c3d4e5f60718293a4b5c6d7e8f90123456789abcdef0123456789abcdef0 \
    STORAGE_FILE_SIGNING_KEY=abcdef0123456789a1b2c3d4e5f60718293a4b5c6d7e8f90123456789abcdef0

EXPOSE 5000

USER node

CMD ["node", "api.js"]
