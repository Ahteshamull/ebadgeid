#!/usr/bin/env node
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const force = process.argv.includes('--force');
const randomSecret = () => crypto.randomBytes(48).toString('base64url');
const mainJwt = randomSecret();
const helpdeskJwt = randomSecret();
// MongoDB accepts a keyfile containing Base64 characters only.  randomSecret()
// is URL-safe Base64 and can include '-' or '_', which mongod rejects.
const randomMongoKey = () => crypto.randomBytes(48).toString('base64');

function replaceValue(content, name, value) {
  const pattern = new RegExp(`^${name}=.*$`, 'm');
  if (!pattern.test(content)) throw new Error(`Missing ${name} in environment template`);
  return content.replace(pattern, `${name}=${value}`);
}

function createEnvironment(relativeExample, replacements) {
  const example = path.join(root, relativeExample);
  const target = example.replace(/\.example$/, '');
  if (fs.existsSync(target) && !force) {
    throw new Error(`${path.relative(root, target)} already exists; use --force only if replacement is intentional`);
  }
  let content = fs.readFileSync(example, 'utf8');
  for (const [name, value] of Object.entries(replacements)) content = replaceValue(content, name, value);
  fs.writeFileSync(target, content, { mode: 0o600, flag: force ? 'w' : 'wx' });
  process.stdout.write(`Created ${path.relative(root, target)} with mode 0600\n`);
}

function createMongoKeyfile(key) {
  const directory = path.join(root, 'runtime-secrets');
  const target = path.join(directory, 'mongo-keyfile');
  if (fs.existsSync(target) && !force) {
    throw new Error(`${path.relative(root, target)} already exists; use --force only if replacement is intentional`);
  }
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  fs.writeFileSync(target, `${key}\n`, { mode: 0o600, flag: force ? 'w' : 'wx' });
  fs.chmodSync(target, 0o600);
  process.stdout.write(`Created ${path.relative(root, target)} with mode 0600\n`);
}

createEnvironment('backend (updated)/.env.example', {
  JWT_SECRET: mainJwt,
  HELPDESK_JWT_SECRET: helpdeskJwt,
  ENCRYPTION_SECRET: randomSecret(),
  CERTIFICATE_INTERNAL_KEY: randomSecret(),
  BACKUP_ENCRYPTION_KEY: randomSecret(),
});
createEnvironment('help_backend/.env.example', { JWT_SECRET: helpdeskJwt });
const mongoReplicaKey = randomMongoKey();
createEnvironment('.env.example', {
  MONGO_ROOT_PASSWORD: randomSecret(),
  MONGO_APP_PASSWORD: randomSecret(),
  MONGO_HELPDESK_APP_PASSWORD: randomSecret(),
  MONGO_BACKUP_PASSWORD: randomSecret(),
  MONGO_REPLICA_KEY: mongoReplicaKey,
  REDIS_PASSWORD: randomSecret(),
  STORAGE_FILE_SIGNING_KEY: randomSecret(),
});
createMongoKeyfile(mongoReplicaKey);
process.stdout.write('Development secrets generated. Configure email providers and HTTPS production URLs before deployment.\n');
