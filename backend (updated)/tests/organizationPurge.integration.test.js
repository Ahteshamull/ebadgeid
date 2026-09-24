// tests/organizationPurge.integration.test.js
//
// E2E audit H-22 follow-up: deleteOrganization only ever soft-deletes.
// This is the other half of that decision, implemented in
// services/organizationPurgeService.js -- after a 90-day retention
// window, a soft-deleted organization's data is permanently removed
// everywhere it exists in the database. Real MongoDB transaction (see
// scoreApprovalConcurrency.integration.test.js's header comment for why
// this needs MongoMemoryReplSet, not a plain MongoMemoryServer).
const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { MongoMemoryReplSet } = require('mongodb-memory-server');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test_secret_for_unit_tests_only';

let replSet;
let purgeExpiredOrganizations;
let purgeOrganization;
let PURGE_RETENTION_DAYS;

let Organization, Users, Auth, Notifications, DigitalContract, ContractAccess,
  DesignShare, Design, Score, Completion, Goal, ApiKey, Credentials;

test.before(async () => {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(replSet.getUri());

  ({ purgeExpiredOrganizations, purgeOrganization, PURGE_RETENTION_DAYS } = require('../services/organizationPurgeService'));
  Organization = require('../models/organization_schema');
  Users = require('../models/user_model');
  Auth = require('../models/AuthCredentials');
  Notifications = require('../models/notificationsSchema');
  DigitalContract = require('../models/digitalContract');
  ContractAccess = require('../models/contractAccess');
  DesignShare = require('../models/designShare');
  Design = require('../models/designSchema');
  Score = require('../models/score_schema');
  Completion = require('../models/task_completion');
  Goal = require('../models/goal_schema');
  ApiKey = require('../models/api_keys');
  Credentials = require('../models/credentialSchema');

  await Organization.init();
});

test.after(async () => {
  await mongoose.disconnect();
  await replSet.stop();
});

function daysAgo(n) {
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000);
}

async function seedFullOrganization(organization_code, { deletedDaysAgo } = {}) {
  await Organization.create({
    organization_code, name: `Purge Test ${organization_code}`, city: 'C', state: 'S', country: 'PY',
    email: `${organization_code.toLowerCase()}@example.test`, phone: '0', plan: 'Free',
    status: deletedDaysAgo !== undefined ? 'DELETED' : 'ACTIVE',
    deleted_at: deletedDaysAgo !== undefined ? daysAgo(deletedDaysAgo) : undefined,
  });
  await Users.create({
    username: `${organization_code}_user`, organization_code, first_name: 'A', last_name: 'B',
    designation: 'Staff', city: 'C', state: 'S', country: 'PY', email: `${organization_code.toLowerCase()}_user@example.test`, phone: '0', status: 'Active',
  });
  await Auth.create({ username: `${organization_code}_user`, password: 'irrelevant-hash', user_role: 'user' });
  await Notifications.create({ email: `${organization_code.toLowerCase()}_user@example.test`, notification_title: 'Hi', notification_description: 'Body', issued_at: new Date().toISOString() });
  await Goal.create({ organization_code, goal_code: `GOAL-${organization_code}`, name: 'Goal', total_score: 100, qualifying_score: 60, start_date: '2026-01-01', end_date: '2026-12-31' });
  await Score.create({ organization_code, goal_code: `GOAL-${organization_code}`, username: `${organization_code}_user`, score: 10 });
  await Completion.create({ username: `${organization_code}_user`, message: 'done', organization_code, goal_code: `GOAL-${organization_code}`, status: 'under_review' });
  await ApiKey.create({ organization_code, valid_for: 30, status: 'Active', requests_allowed_per_minute: 60, api_key_hash: `hash-${organization_code}` });
  await Credentials.create({
    credential_code: `CRED-${organization_code}`, achiever_username: `${organization_code}_user`, organization_code,
    credential_title: 'A credential', credential_pic_url: 'https://example.test/p.png', credential_status: 'Issued',
    credential_issue_date: '2026-01-01', credential_expiry_date: '2099-01-01', credential_blockchain_hashes: 'h',
  });
  await Design.create({ organization_code, design_code: `DESIGN-${organization_code}`, main_template_url: 'https://example.test/t.png', template_url: 'https://example.test/t.png' });
  await DigitalContract.create({
    contract_code: `CONTRACT-${organization_code}`, creator_username: `${organization_code}_user`, contract_issue_date: '2026-01-01',
    contract_status: 'active', contract_content_url: 'https://example.test/c.pdf', contract_security_hashes: 'h', organization_code,
    contract_parties: [{ party_name: 'Party', party_side: 'buyer', party_role: 'signer', party_email: `${organization_code.toLowerCase()}_party@example.test` }],
  });
  await ContractAccess.create({ contract_code: `CONTRACT-${organization_code}`, access_token: `token-${organization_code}-${Math.random()}`, permissions: { view: true }, expires_at: daysAgo(-30), issued_to_email: `${organization_code.toLowerCase()}_party@example.test` });
}

async function countAllFor(organization_code) {
  return {
    organization: await Organization.countDocuments({ organization_code }),
    users: await Users.countDocuments({ organization_code }),
    auth: await Auth.countDocuments({ username: `${organization_code}_user` }),
    notifications: await Notifications.countDocuments({ email: `${organization_code.toLowerCase()}_user@example.test` }),
    goals: await Goal.countDocuments({ organization_code }),
    scores: await Score.countDocuments({ organization_code }),
    completions: await Completion.countDocuments({ organization_code }),
    apiKeys: await ApiKey.countDocuments({ organization_code }),
    credentials: await Credentials.countDocuments({ organization_code }),
    designs: await Design.countDocuments({ organization_code }),
    contracts: await DigitalContract.countDocuments({ organization_code }),
    contractAccess: await ContractAccess.countDocuments({ contract_code: `CONTRACT-${organization_code}` }),
  };
}

test('purgeOrganization permanently removes every collection\'s data for a soft-deleted organization', async () => {
  const ORG = 'ORG-PURGE-FULL';
  await seedFullOrganization(ORG, { deletedDaysAgo: 100 });

  const before = await countAllFor(ORG);
  assert.ok(Object.values(before).every((c) => c >= 1), 'sanity check: every collection has at least one seeded document');

  const result = await purgeOrganization(ORG);
  assert.equal(result.organization_code, ORG);

  const after = await countAllFor(ORG);
  for (const [collection, count] of Object.entries(after)) {
    assert.equal(count, 0, `${collection} must have 0 documents left for ${ORG} after purge`);
  }
});

test('purgeOrganization purges DesignShare records in both the source and target direction', async () => {
  const SOURCE = 'ORG-PURGE-SHARE-SRC';
  const TARGET = 'ORG-PURGE-SHARE-TGT';
  await Organization.create([
    { organization_code: SOURCE, name: 'Source', city: 'C', state: 'S', country: 'PY', email: 'src@example.test', phone: '0', status: 'DELETED', plan: 'Free', deleted_at: daysAgo(100) },
    { organization_code: TARGET, name: 'Target', city: 'C', state: 'S', country: 'PY', email: 'tgt@example.test', phone: '0', status: 'ACTIVE', plan: 'Free' },
  ]);
  await DesignShare.create({ design_code: 'DESIGN-SHARE-TEST', source_organization_code: SOURCE, target_organization_code: TARGET, shared_by: 'someone' });

  await purgeOrganization(SOURCE);

  const shareGone = await DesignShare.countDocuments({ design_code: 'DESIGN-SHARE-TEST' });
  assert.equal(shareGone, 0, 'a share involving the purged org (as source) must be gone, even though the target org is untouched');
  const targetStillExists = await Organization.countDocuments({ organization_code: TARGET });
  assert.equal(targetStillExists, 1, 'the unrelated target organization itself must survive');
});

test('purgeOrganization refuses to purge an organization that is not (or no longer) DELETED', async () => {
  const ORG = 'ORG-PURGE-ACTIVE-GUARD';
  await seedFullOrganization(ORG); // status defaults to ACTIVE

  await assert.rejects(() => purgeOrganization(ORG), /not in a purgeable state/);

  const after = await countAllFor(ORG);
  assert.equal(after.organization, 1, 'an active organization must never be purged, even if called directly');
  assert.equal(after.users, 1, 'and none of its data either -- the whole transaction must have rolled back');
});

test('purgeExpiredOrganizations only purges organizations past the retention window, leaving everything else untouched', async () => {
  const EXPIRED = 'ORG-PURGE-EXPIRED';
  const RECENT = 'ORG-PURGE-RECENT';
  const ACTIVE_SIBLING = 'ORG-PURGE-ACTIVE-SIBLING';

  await seedFullOrganization(EXPIRED, { deletedDaysAgo: PURGE_RETENTION_DAYS + 10 });
  await seedFullOrganization(RECENT, { deletedDaysAgo: PURGE_RETENTION_DAYS - 10 });
  await seedFullOrganization(ACTIVE_SIBLING);

  const result = await purgeExpiredOrganizations();
  assert.ok(result.checked >= 1);
  assert.ok(result.purged >= 1);
  assert.ok(result.results.some((r) => r.organization_code === EXPIRED));
  assert.ok(!result.results.some((r) => r.organization_code === RECENT), 'a soft-deleted org still inside its retention window must not be purged yet');
  assert.ok(!result.results.some((r) => r.organization_code === ACTIVE_SIBLING), 'an active organization must never be selected for purge');

  const expiredAfter = await countAllFor(EXPIRED);
  assert.equal(expiredAfter.organization, 0, 'the expired organization must be fully gone');

  const recentAfter = await countAllFor(RECENT);
  assert.equal(recentAfter.organization, 1, 'the recently-deleted organization (still inside retention) must be untouched');
  assert.equal(recentAfter.users, 1);

  const siblingAfter = await countAllFor(ACTIVE_SIBLING);
  assert.equal(siblingAfter.organization, 1, 'the unrelated active organization must be completely untouched');
  assert.equal(siblingAfter.users, 1);
});
