// services/backupService.js
//
// Production checklist item ("MongoDB productivo... backups probados",
// "Backups cifrados automáticos... prueba de restauración") -- was
// documentation-only (docs/OPERATIONS_RUNBOOK.md described the policy in
// prose) with no actual implementation anywhere in the repo. This is
// that implementation.
//
// Deliberately does NOT shell out to mongodump/mongorestore: the
// official MongoDB Database Tools don't ship musl/Alpine binaries (this
// project's Docker images are node:22-alpine), and pulling in a second,
// glibc-based image just for this would be a real added dependency.
// Instead this dumps every document through the same BSON Extended JSON
// (EJSON) the `bson` package (already a transitive dependency of
// mongoose/mongodb) uses internally -- it round-trips ObjectId, Date,
// Buffer, etc. correctly, unlike a naive JSON.stringify.
//
// Least privilege: backup creation connects with MONGO_BACKUP_URI, a
// dedicated user with only the `read` role on each database (see
// PRODUCTION_RUNBOOK.md for the exact createUser command) -- it
// physically cannot write, so a compromised backup process can't also
// be a data-destruction vector.
const fs = require('fs');
const path = require('path');
const { MongoClient } = require('mongodb');
const { EJSON } = require('bson');
const { encryptBuffer, decryptBuffer } = require('../utils/backupEncryption');
const logger = require('../utils/logger');

const DATABASES_TO_BACKUP = ['ebadgeid', 'ebadgeid_helpdesk'];
const DEFAULT_BACKUP_ROOT = process.env.BACKUP_DIR || path.join(__dirname, '..', 'backups');
// Local retention -- how many days of daily backups to keep ON the
// server. This is NOT the full retention policy (docs/OPERATIONS_RUNBOOK.md
// calls for diaria/semanal/mensual, off-server too) -- syncing these
// encrypted, already-at-rest-protected folders to off-server storage
// (S3, Backblaze, an ops-owned bucket) is an infrastructure choice for
// whoever operates the real server, deliberately left as a next step
// (see PRODUCTION_RUNBOOK.md) rather than guessed at here.
const LOCAL_BACKUP_RETENTION_DAYS = 14;

function timestampDirName(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, '-');
}

async function dumpCollection(db, collectionName, destDir, dbName, session) {
  const cursor = db.collection(collectionName).find({}, { session });
  const lines = [];
  for await (const doc of cursor) {
    lines.push(EJSON.stringify(doc));
  }
  const plaintext = Buffer.from(lines.join('\n'), 'utf8');
  const encrypted = encryptBuffer(plaintext);
  const fileName = `${dbName}__${collectionName}.jsonl.enc`;
  fs.writeFileSync(path.join(destDir, fileName), encrypted);
  return lines.length;
}

async function createBackup({ outputRoot = DEFAULT_BACKUP_ROOT } = {}) {
  if (!process.env.MONGO_BACKUP_URI) throw new Error('MONGO_BACKUP_URI is not set — cannot create a backup');
  const client = new MongoClient(process.env.MONGO_BACKUP_URI);
  const backupDir = path.join(outputRoot, timestampDirName());
  fs.mkdirSync(backupDir, { recursive: true });

  const manifest = { created_at: new Date().toISOString(), databases: {} };
  // MED-02 fix (audit finding, confirmed real): each collection used to be
  // dumped with its own independent find({}) cursor, one after another --
  // a write landing on a different collection (or even the same one)
  // between two of those cursors could leave the backup with a state that
  // never actually existed at any single instant (e.g. a credential
  // referencing a user created or deleted mid-backup, captured in one
  // collection's dump but not the other's). A real multi-document
  // transaction is heavier than this needs (backups are read-only) --
  // a snapshot session (real MongoDB replica-set feature, requires 5.0+,
  // which this project already runs) gives every read within it the exact
  // same point-in-time view across every collection and both databases,
  // without taking any write locks.
  const session = client.startSession({ snapshot: true });
  try {
    await client.connect();
    for (const dbName of DATABASES_TO_BACKUP) {
      const db = client.db(dbName);
      const collections = await db.listCollections({}, { nameOnly: true }).toArray();
      manifest.databases[dbName] = {};
      for (const { name: collectionName } of collections) {
        const count = await dumpCollection(db, collectionName, backupDir, dbName, session);
        manifest.databases[dbName][collectionName] = count;
      }
    }
  } finally {
    await session.endSession();
    await client.close();
  }

  fs.writeFileSync(path.join(backupDir, 'manifest.json.enc'), encryptBuffer(Buffer.from(JSON.stringify(manifest), 'utf8')));

  const removed = pruneOldBackups(outputRoot);
  logger.info('backup_created', { backup_dir: backupDir, databases: Object.keys(manifest.databases), removed_old_backups: removed });
  return { backupDir, manifest };
}

function pruneOldBackups(outputRoot = DEFAULT_BACKUP_ROOT) {
  if (!fs.existsSync(outputRoot)) return 0;
  const cutoff = Date.now() - LOCAL_BACKUP_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  let removed = 0;
  for (const entry of fs.readdirSync(outputRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const fullPath = path.join(outputRoot, entry.name);
    const stat = fs.statSync(fullPath);
    if (stat.mtimeMs < cutoff) {
      fs.rmSync(fullPath, { recursive: true, force: true });
      removed += 1;
    }
  }
  return removed;
}

function readManifest(backupDir) {
  const encrypted = fs.readFileSync(path.join(backupDir, 'manifest.json.enc'));
  return JSON.parse(decryptBuffer(encrypted).toString('utf8'));
}

// Restores into <dbName><targetSuffix> by default -- NEVER the original
// database name unless the caller explicitly opts in with
// targetSuffix: '' (a real disaster-recovery restore, not a routine
// restore-test), so running this against a real environment can never
// silently clobber live data.
async function restoreBackup(backupDir, { connectionUri, targetSuffix = '__restore_test' } = {}) {
  const uri = connectionUri || process.env.MONGO_RESTORE_URI;
  if (!uri) throw new Error('No MongoDB connection URI provided for restore (pass connectionUri or set MONGO_RESTORE_URI)');
  const manifest = readManifest(backupDir);

  const client = new MongoClient(uri);
  const restored = {};
  try {
    await client.connect();
    for (const [dbName, collections] of Object.entries(manifest.databases)) {
      const targetDbName = `${dbName}${targetSuffix}`;
      const db = client.db(targetDbName);
      // MED-02 fix (audit finding, confirmed real): running this twice in
      // a row against the same __restore_test target used to fail --
      // insertMany hit duplicate-key errors for every document already
      // there from the previous run, since nothing ever cleared the
      // target first. A restore is supposed to reproduce exactly what the
      // backup contains, not merge with whatever was already in the
      // target database (real disaster recovery works the same way: you
      // restore INTO a wiped target, not on top of a possibly-corrupted
      // "current" one). Dropping first makes every restore-test run
      // idempotent and its result byte-for-byte reproducible.
      await db.dropDatabase();
      restored[targetDbName] = {};
      for (const collectionName of Object.keys(collections)) {
        const filePath = path.join(backupDir, `${dbName}__${collectionName}.jsonl.enc`);
        const encrypted = fs.readFileSync(filePath);
        const plaintext = decryptBuffer(encrypted).toString('utf8');
        const docs = plaintext.length ? plaintext.split('\n').map((line) => EJSON.parse(line)) : [];
        if (docs.length) {
          // ordered: false -- a single bad document (there shouldn't be
          // one; this is our own backup) doesn't abort restoring the rest.
          await db.collection(collectionName).insertMany(docs, { ordered: false });
        }
        restored[targetDbName][collectionName] = docs.length;
      }
    }
  } finally {
    await client.close();
  }

  logger.info('backup_restore_test_completed', { backup_dir: backupDir, restored });
  return { restored, manifest };
}

module.exports = { createBackup, restoreBackup, pruneOldBackups, readManifest, DATABASES_TO_BACKUP, LOCAL_BACKUP_RETENTION_DAYS };
