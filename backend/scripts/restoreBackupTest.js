// scripts/restoreBackupTest.js
//
// Manual, deliberate restore-test -- NOT part of the automated nightly
// cron (docs/OPERATIONS_RUNBOOK.md calls for a quarterly restore test in
// an isolated environment, not a nightly one). Run by hand:
//
//   node scripts/restoreBackupTest.js [path-to-backup-dir]
//
// Defaults to the most recent backup under BACKUP_DIR (or ./backups).
// Restores into <database>__restore_test databases using MONGO_RESTORE_URI
// (the root/admin credential -- see PRODUCTION_RUNBOOK.md; the automated
// backup job itself uses a read-only user and could never write a
// restore even if it wanted to). Never touches the real database names.
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { restoreBackup } = require('../services/backupService');

function mostRecentBackupDir(root) {
  if (!fs.existsSync(root)) throw new Error(`No backups found under ${root}`);
  const entries = fs.readdirSync(root, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => path.join(root, e.name))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  if (!entries.length) throw new Error(`No backups found under ${root}`);
  return entries[0];
}

async function run(backupDirArg) {
  const root = process.env.BACKUP_DIR || path.join(__dirname, '..', 'backups');
  const backupDir = backupDirArg || mostRecentBackupDir(root);
  const result = await restoreBackup(backupDir);
  console.log(JSON.stringify({
    event: 'restore_test_complete',
    backup_dir: backupDir,
    restored: Object.fromEntries(Object.entries(result.restored).map(([db, cols]) => [
      db,
      Object.values(cols).reduce((sum, n) => sum + n, 0),
    ])),
  }));
  return result;
}

if (require.main === module) {
  run(process.argv[2]).catch((error) => {
    console.error(JSON.stringify({ event: 'restore_test_failed', message: error.message }));
    process.exit(1);
  });
}

module.exports = { run };
