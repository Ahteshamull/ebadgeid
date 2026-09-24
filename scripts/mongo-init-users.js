// Executed exactly once by the official Mongo image on a fresh data volume
// (mounted at /docker-entrypoint-initdb.d/, the image's own convention).
// Root is created by MONGO_INITDB_ROOT_* before this script runs.
const appPassword = process.env.MONGO_APP_PASSWORD;
const helpdeskPassword = process.env.MONGO_HELPDESK_APP_PASSWORD;
const backupPassword = process.env.MONGO_BACKUP_PASSWORD;
if (!appPassword || !helpdeskPassword || !backupPassword) {
  throw new Error('MONGO_APP_PASSWORD, MONGO_HELPDESK_APP_PASSWORD, and MONGO_BACKUP_PASSWORD are required for first MongoDB initialization');
}

db.getSiblingDB('ebadgeid').createUser({
  user: 'ebadgeid_app',
  pwd: appPassword,
  roles: [{ role: 'readWrite', db: 'ebadgeid' }],
});
db.getSiblingDB('ebadgeid_helpdesk').createUser({
  user: 'ebadgeid_helpdesk_app',
  pwd: helpdeskPassword,
  roles: [{ role: 'readWrite', db: 'ebadgeid_helpdesk' }],
});
// Read-only, both databases -- backend (updated)/services/backupService.js's
// automated daily backup job. Never granted write anywhere, on principle:
// a compromised backup process should never also be a data-destruction vector.
db.getSiblingDB('admin').createUser({
  user: 'backup_reader',
  pwd: backupPassword,
  roles: [
    { role: 'read', db: 'ebadgeid' },
    { role: 'read', db: 'ebadgeid_helpdesk' },
  ],
});
