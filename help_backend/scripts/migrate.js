require('dotenv').config();

const mongoose = require('mongoose');

const migrations = [
  {
    id: '20260815_backfill_ticket_tenants',
    async run(db) {
      const tickets = db.collection('tickets');
      const users = db.collection('users');
      let migrated = 0;
      const cursor = tickets.find({ $or: [
        { organization_code: { $exists: false } },
        { organization_code: null },
        { organization_code: '' },
      ] });
      for await (const ticket of cursor) {
        const identities = (ticket.ticket_members || []).map(member => String(member.usernameOrEmail || '').toLowerCase());
        const owner = await users.findOne({ $or: [{ email: { $in: identities } }, { username: { $in: identities } }] });
        const orgCode = owner?.org_code || process.env.DEFAULT_ORG_CODE;
        if (!orgCode) throw new Error(`Cannot assign organization to ticket ${ticket.ticket_code}`);
        await tickets.updateOne({ _id: ticket._id }, { $set: { organization_code: orgCode } });
        migrated += 1;
      }
      return { migrated };
    },
  },
  {
    id: '20260815_backfill_helpdesk_organization_code',
    async run(db) {
      if (!process.env.DEFAULT_ORG_CODE) return { migrated: 0 };
      const organizations = db.collection('organizations');
      const missing = await organizations.countDocuments({ organization_code: { $exists: false } });
      if (missing > 1) {
        throw new Error('Multiple legacy helpdesk organizations require an explicit organization-code mapping');
      }
      const result = await organizations.updateOne(
        { organization_code: { $exists: false } },
        { $set: { organization_code: process.env.DEFAULT_ORG_CODE } }
      );
      return { migrated: result.modifiedCount };
    },
  },
  {
    id: '20260815_backfill_helpdesk_content_tenants',
    async run(db) {
      if (!process.env.DEFAULT_ORG_CODE) throw new Error('DEFAULT_ORG_CODE is required to migrate helpdesk content');
      const filter = { $or: [
        { organization_code: { $exists: false } },
        { organization_code: null },
        { organization_code: '' },
      ] };
      const [faqs, articles] = await Promise.all([
        db.collection('faqs').updateMany(filter, { $set: { organization_code: process.env.DEFAULT_ORG_CODE } }),
        db.collection('articles').updateMany(filter, { $set: { organization_code: process.env.DEFAULT_ORG_CODE } }),
      ]);
      return { faqs: faqs.modifiedCount, articles: articles.modifiedCount };
    },
  },
  {
    id: '20260815_publish_existing_helpdesk_articles',
    async run(db) {
      const result = await db.collection('articles').updateMany({
        published: { $exists: false },
        article_content: { $type: 'string', $ne: '' },
      }, { $set: { published: true } });
      return { migrated: result.modifiedCount };
    },
  },
  {
    id: '20260827_scope_helpdesk_identities_by_organization',
    async run(db) {
      const users = db.collection('users');
      const otpTokens = db.collection('otptokens');
      const defaultOrg = process.env.DEFAULT_ORG_CODE;
      const missingUsers = await users.countDocuments({ $or: [
        { org_code: { $exists: false } }, { org_code: null }, { org_code: '' },
      ] });
      if (missingUsers && !defaultOrg) {
        throw new Error('DEFAULT_ORG_CODE is required to scope legacy helpdesk users');
      }
      if (missingUsers) await users.updateMany(
        { $or: [{ org_code: { $exists: false } }, { org_code: null }, { org_code: '' }] },
        { $set: { org_code: defaultOrg } }
      );

      const removeIndexIfPresent = async (collection, name) => {
        // MongoDB returns NamespaceNotFound when a clean installation has not
        // created this collection yet.  That is a valid state: the following
        // createIndex calls create it as needed.  Treat it as "no legacy index"
        // instead of failing the entire bootstrap migration.
        let indexes;
        try {
          indexes = await collection.indexes();
        } catch (error) {
          if (error?.codeName === 'NamespaceNotFound' || error?.code === 26) return;
          throw error;
        }
        if (indexes.some(index => index.name === name)) await collection.dropIndex(name);
      };
      // Legacy global indexes have to be removed before the equivalent
      // tenant-scoped indexes can allow the same identity in two orgs.
      await removeIndexIfPresent(users, 'email_1');
      await removeIndexIfPresent(users, 'username_1');
      await users.createIndex({ org_code: 1, email: 1 }, { unique: true, name: 'org_email_unique' });
      await users.createIndex(
        { org_code: 1, username: 1 },
        { unique: true, partialFilterExpression: { username: { $type: 'string' } }, name: 'org_username_unique' }
      );

      const missingOtp = await otpTokens.countDocuments({ $or: [
        { org_code: { $exists: false } }, { org_code: null }, { org_code: '' },
      ] });
      if (missingOtp && !defaultOrg) {
        throw new Error('DEFAULT_ORG_CODE is required to scope legacy OTP records');
      }
      if (missingOtp) await otpTokens.updateMany(
        { $or: [{ org_code: { $exists: false } }, { org_code: null }, { org_code: '' }] },
        { $set: { org_code: defaultOrg } }
      );
      await removeIndexIfPresent(otpTokens, 'emailOrUsername_1');
      await otpTokens.createIndex({ org_code: 1, emailOrUsername: 1 }, { unique: true, name: 'org_otp_identity_unique' });
      return { usersScoped: missingUsers, otpRecordsScoped: missingOtp };
    },
  },
  {
    id: '20260827_persist_ai_cost_analytics',
    async run(db) {
      const costs = db.collection('chat_costs');
      const daily = db.collection('chat_cost_daily');
      await costs.createIndex({ organization_code: 1, session_id: 1 }, { unique: true, name: 'org_session_cost_unique' });
      await costs.createIndex({ organization_code: 1, last_activity_at: -1 }, { name: 'org_cost_recent' });
      await costs.createIndex({ expires_at: 1 }, { expireAfterSeconds: 0, name: 'chat_cost_retention_ttl' });
      await daily.createIndex({ organization_code: 1, day: 1 }, { unique: true, name: 'org_daily_cost_unique' });
      await daily.createIndex({ expires_at: 1 }, { expireAfterSeconds: 0, name: 'chat_cost_daily_retention_ttl' });
      return { retentionDays: Number.parseInt(process.env.AI_COST_RETENTION_DAYS || '90', 10) || 90 };
    },
  },
];

async function migrate() {
  if (!process.env.MONGO_URI) throw new Error('MONGO_URI is required');
  if (process.env.MONGO_URI.startsWith('mongodb+srv://')) {
    try { require('dns').setServers(['8.8.8.8', '1.1.1.1']); } catch (_) {}
  }
  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 10_000 });
  const db = mongoose.connection.db;
  const records = db.collection('schema_migrations');
  await records.createIndex({ id: 1 }, { unique: true });
  for (const migration of migrations) {
    if (await records.findOne({ id: migration.id })) continue;
    const result = await migration.run(db);
    await records.insertOne({ id: migration.id, applied_at: new Date(), result });
    console.log(JSON.stringify({ event: 'migration_applied', id: migration.id, result }));
  }
  await mongoose.disconnect();
}

if (require.main === module) {
  migrate().catch(async error => {
    console.error(JSON.stringify({ event: 'migration_failed', message: error.message }));
    await mongoose.disconnect().catch(() => {});
    process.exit(1);
  });
}

module.exports = { migrate, migrations };
