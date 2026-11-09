FROM node:22-alpine
WORKDIR /app
# xmllint (libxml2-utils) is required at runtime by
# @authenio/samlify-node-xmllint (services/samlAuth.js) -- samlify won't
# parse any inbound SAML XML at all without a real schema validator wired
# up, and this is the one that doesn't need a JDK (the alternative
# @authenio/samlify-xsd-schema-validator shells out to javac).
RUN apk add --no-cache libxml2-utils
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --chown=node:node . .
# uploads/ is deliberately excluded from the build context (.dockerignore)
# and gets mounted over by the uploads_data named volume at runtime -- but
# a named volume with nothing pre-existing at its mount point is created by
# Docker as root:root, which the non-root `node` user below can never write
# into. Docker only copies an image directory's ownership into a *freshly
# created* named volume, so this has to exist, owned by node, before that
# first mount happens (a chown after the fact on an already-initialized
# volume would need to run every container start, on every service sharing
# this volume, instead of being solved once here).
RUN mkdir -p /app/uploads /app/backups /app/private-contracts && chown -R node:node /app/uploads /app/backups /app/private-contracts
ENV NODE_ENV=production PORT=5000
EXPOSE 5000
USER node
CMD ["node", "api.js"]
