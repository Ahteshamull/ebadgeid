// tests/backupRestore.integration.test.js
//
// Production checklist: "MongoDB productivo... backups probados" --
// previously just prose in docs/OPERATIONS_RUNBOOK.md with no real
// implementation to test at all. This proves services/backupService.js
// for real: a real MongoDB (mongodb-memory-server, real mongod binary),
// real documents with type-sensitive fields (ObjectId, Date, nested
// arrays/objects), a real encrypted backup written to a real temp
// directory, and a real restore that round-trips every document back
// out byte-for-byte (not just "same JSON.stringify", which would hide a
// Date silently becoming a string or an ObjectId becoming a plain
// string) -- plus the safety property that a routine restore-test can
// never touch the original database name, and that a tampered backup
// file fails to decrypt instead of silently returning garbage.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { MongoClient, ObjectId } = require('mongodb');
const { MongoMemoryReplSet } = require('mongodb-memory-server');

process.env.BACKUP_ENCRYPTION_KEY = process.env.BACKUP_ENCRYPTION_KEY || 'test_backup_encryption_key_at_least_32_bytes_long';

let mongod;
let tmpRoot;

test.before(async () => {
  // MongoMemoryReplSet, not a plain MongoMemoryServer (MED-02 fix): a
  // snapshot session (services/backupService.js's createBackup, added to
  // fix a real cross-collection consistency gap) is a real-replica-set-
  // only MongoDB feature -- it errors with "node needs to be a replica
  // set member" against a standalone mongod. Production already always
  // runs Mongo as a single-node replica set (docker-compose.yml's
  // --replSet rs0 is unconditional, not optional), so this matches real
  // deployment, not a test-only requirement. Same pattern already
  // established for transactions elsewhere in this suite (see
  // tests/selfServiceSignup.integration.test.js's header comment).
  mongod = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  process.env.MONGO_BACKUP_URI = mongod.getUri();
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ebadge-backup-test-'));
});

test.after(async () => {
  await mongod.stop();
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

async function seedFixtureData() {
  const client = new MongoClient(mongod.getUri());
  await client.connect();
  try {
    // Each test that seeds fixture data asserts exact collection counts
    // in the resulting backup manifest -- start from a clean slate every
    // time so one test's leftover documents (all tests share the same
    // in-memory mongod for speed) never inflate another test's counts.
    await client.db('ebadgeid').collection('users').deleteMany({});
    await client.db('ebadgeid').collection('credentials').deleteMany({});
    await client.db('ebadgeid_helpdesk').collection('tickets').deleteMany({});

    const mainUserId = new ObjectId();
    await client.db('ebadgeid').collection('users').insertOne({
      _id: mainUserId,
      username: 'backup_test_user',
      organization_code: 'ORG-BACKUP-TEST',
      created_at: new Date('2026-01-15T10:30:00.000Z'),
      tags: ['a', 'b', 'c'],
      profile: { first_name: 'Backup', last_name: 'Test', nested: { deep: true } },
    });
    await client.db('ebadgeid').collection('credentials').insertOne({
      _id: new ObjectId(),
      credential_code: 'CRED-BACKUP-TEST',
      achiever_user_id: mainUserId,
      credential_issue_date: new Date('2026-02-01T00:00:00.000Z'),
      credential_status: 'Claimed',
    });
    await client.db('ebadgeid_helpdesk').collection('tickets').insertOne({
      _id: new ObjectId(),
      subject: 'Backup test ticket',
      created_at: new Date('2026-03-01T00:00:00.000Z'),
      history: [{ event: 'created', at: new Date('2026-03-01T00:00:00.000Z') }],
    });
    return { mainUserId };
  } finally {
    await client.close();
  }
}

test('createBackup writes an encrypted, non-plaintext file per collection, and a manifest with correct counts', async () => {
  await seedFixtureData();
  const { createBackup } = require('../services/backupService');
  const outputRoot = path.join(tmpRoot, 'run1');
  const { backupDir, manifest } = await createBackup({ outputRoot });

  assert.equal(manifest.databases.ebadgeid.users, 1);
  assert.equal(manifest.databases.ebadgeid.credentials, 1);
  assert.equal(manifest.databases.ebadgeid_helpdesk.tickets, 1);

  const usersFile = path.join(backupDir, 'ebadgeid__users.jsonl.enc');
  assert.ok(fs.existsSync(usersFile));
  const raw = fs.readFileSync(usersFile);
  assert.doesNotMatch(raw.toString('latin1'), /backup_test_user/, 'the username must never appear in plaintext in the encrypted file on disk');
});

test('restoreBackup round-trips every document exactly, including ObjectId and Date fields, without touching the original database', async () => {
  const { mainUserId } = await seedFixtureData();
  const { createBackup, restoreBackup } = require('../services/backupService');
  const outputRoot = path.join(tmpRoot, 'run2');
  const { backupDir } = await createBackup({ outputRoot });

  const result = await restoreBackup(backupDir, { connectionUri: mongod.getUri() });
  assert.equal(result.restored['ebadgeid__restore_test'].users, 1);
  assert.equal(result.restored['ebadgeid_helpdesk__restore_test'].tickets, 1);

  const client = new MongoClient(mongod.getUri());
  await client.connect();
  try {
    const restoredUser = await client.db('ebadgeid__restore_test').collection('users').findOne({ username: 'backup_test_user' });
    assert.ok(restoredUser, 'the restored document must exist under the __restore_test database');
    assert.ok(restoredUser._id instanceof ObjectId, '_id must round-trip as a real ObjectId, not a string');
    assert.ok(restoredUser._id.equals(mainUserId));
    assert.ok(restoredUser.created_at instanceof Date, 'created_at must round-trip as a real Date instance, not a string');
    assert.equal(restoredUser.created_at.toISOString(), '2026-01-15T10:30:00.000Z');
    assert.deepEqual(restoredUser.tags, ['a', 'b', 'c']);
    assert.equal(restoredUser.profile.nested.deep, true);

    const restoredTicket = await client.db('ebadgeid_helpdesk__restore_test').collection('tickets').findOne({ subject: 'Backup test ticket' });
    assert.ok(restoredTicket.history[0].at instanceof Date, 'a Date nested inside an array of objects must also round-trip as a real Date');

    // The original databases must be completely unaffected by a restore-test.
    const originalUsersCount = await client.db('ebadgeid').collection('users').countDocuments({});
    assert.equal(originalUsersCount, 1, 'the real ebadgeid.users collection must be untouched by a routine restore-test');
  } finally {
    await client.close();
  }
});

test('pruneOldBackups removes only backups older than the retention window', async () => {
  const { pruneOldBackups, LOCAL_BACKUP_RETENTION_DAYS } = require('../services/backupService');
  const outputRoot = path.join(tmpRoot, 'run3');
  const oldDir = path.join(outputRoot, 'old-backup');
  const recentDir = path.join(outputRoot, 'recent-backup');
  fs.mkdirSync(oldDir, { recursive: true });
  fs.mkdirSync(recentDir, { recursive: true });

  const oldTime = (Date.now() - (LOCAL_BACKUP_RETENTION_DAYS + 5) * 24 * 60 * 60 * 1000) / 1000;
  fs.utimesSync(oldDir, oldTime, oldTime);

  const removed = pruneOldBackups(outputRoot);
  assert.equal(removed, 1);
  assert.ok(!fs.existsSync(oldDir), 'the expired backup directory must be gone');
  assert.ok(fs.existsSync(recentDir), 'a recent backup directory must survive pruning');
});

test('a tampered backup file fails to decrypt instead of silently returning garbage', async () => {
  await seedFixtureData();
  const { createBackup } = require('../services/backupService');
  const { decryptBuffer } = require('../utils/backupEncryption');
  const outputRoot = path.join(tmpRoot, 'run4');
  const { backupDir } = await createBackup({ outputRoot });

  const usersFile = path.join(backupDir, 'ebadgeid__users.jsonl.enc');
  const original = fs.readFileSync(usersFile);
  const tampered = Buffer.from(original);
  tampered[tampered.length - 1] ^= 0xff; // flip the last byte of the ciphertext
  fs.writeFileSync(usersFile, tampered);

  assert.throws(() => decryptBuffer(fs.readFileSync(usersFile)), 'GCM authentication must reject a tampered ciphertext, not decrypt it into garbage silently');
});

// MED-02 fix (audit finding, confirmed real): restoreBackup used to
// insertMany into __restore_test without ever clearing it first --
// running the restore-test twice in a row (exactly what an operator would
// do re-running scripts/restoreBackupTest.js, or CI re-running this same
// test suite against a long-lived environment) hit duplicate-key errors
// for every document already there from the previous run. This proves
// two consecutive restores into the same target both succeed and produce
// identical, non-duplicated results.
test('running restoreBackup twice in a row against the same target succeeds both times with identical results', async () => {
  await seedFixtureData();
  const { createBackup, restoreBackup } = require('../services/backupService');
  const outputRoot = path.join(tmpRoot, 'run5');
  const { backupDir } = await createBackup({ outputRoot });

  const first = await restoreBackup(backupDir, { connectionUri: mongod.getUri() });
  const second = await restoreBackup(backupDir, { connectionUri: mongod.getUri() });

  assert.deepEqual(first.restored, second.restored, 'restoring the same backup twice must produce the same counts both times, not a duplicate-key failure on the second run');

  const client = new MongoClient(mongod.getUri());
  await client.connect();
  try {
    const count = await client.db('ebadgeid__restore_test').collection('users').countDocuments({});
    assert.equal(count, 1, 'the second restore must not have left duplicate documents behind');
  } finally {
    await client.close();
  }
});
