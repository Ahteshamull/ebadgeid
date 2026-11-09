require('dotenv').config();

const crypto = require('crypto');
const mongoose = require('mongoose');

const migrations = [
  {
    id: '20260815_hash_legacy_api_keys',
    async run(db) {
      const keys = db.collection('apikeys');
      const cursor = keys.find({
        api_key: { $type: 'string', $ne: '' },
        $or: [{ api_key_hash: { $exists: false } }, { api_key_hash: null }],
      });
      let migrated = 0;
      for await (const key of cursor) {
        const hash = crypto.createHash('sha256').update(key.api_key, 'utf8').digest('hex');
        await keys.updateOne(
          { _id: key._id, api_key: key.api_key },
          {
            $set: {
              api_key_hash: hash,
              key_prefix: key.api_key.slice(0, 8),
              last_four: key.api_key.slice(-4),
            },
            $unset: { api_key: '' },
          }
        );
        migrated += 1;
      }
      return { migrated };
    },
  },
  {
    id: '20260815_hash_contract_access_tokens',
    async run(db) {
      const tokens = db.collection('contractaccesses');
      const cursor = tokens.find({
        access_token: { $type: 'string', $ne: '' },
        $or: [{ access_token_hash: { $exists: false } }, { access_token_hash: null }],
      });
      let migrated = 0;
      for await (const token of cursor) {
        const hash = crypto.createHash('sha256').update(token.access_token, 'utf8').digest('hex');
        await tokens.updateOne(
          { _id: token._id, access_token: token.access_token },
          {
            $set: { access_token_hash: hash, token_prefix: token.access_token.slice(0, 8) },
            $unset: { access_token: '' },
          }
        );
        migrated += 1;
      }
      return { migrated };
    },
  },
  {
    // Backfills status:'published' on every template saved before the
    // draft/published field existed, so nothing already in use suddenly
    // becomes unissuable. The schema's own `default: 'published'` covers
    // full Mongoose documents automatically, but generateCertificate
    // (and other real read paths) use `.lean()` for performance, which
    // skips schema-default hydration entirely and would read these as
    // `undefined` -- this migration makes the stored data itself
    // correct, not just documents Mongoose happens to hydrate.
    id: '20260821_backfill_design_status_published',
    async run(db) {
      const designs = db.collection('designs');
      const result = await designs.updateMany(
        { status: { $exists: false } },
        { $set: { status: 'published' } }
      );
      return { migrated: result.modifiedCount };
    },
  },
  {
    id: '20260815_normalize_scores_to_numbers',
    async run(db) {
      const scores = db.collection('scores');
      const cursor = scores.find({ score: { $type: 'string' } });
      let migrated = 0;
      // E2E audit finding H-08: this used to throw on the first
      // unconvertible value, aborting the ENTIRE run -- and since a
      // migration is only recorded as applied after it fully succeeds,
      // every future `npm run migrate` would re-scan from the top and
      // fail on that same document again, permanently blocking this (and
      // any migration registered after it) until someone fixed the data
      // by hand. Skip-and-log instead: one bad document is a data-quality
      // problem to flag and remediate separately, not a reason to block
      // every other organization's legitimate score normalization.
      const skipped = [];
      for await (const score of cursor) {
        const numericScore = Number(score.score);
        if (!Number.isFinite(numericScore) || numericScore < 0) {
          console.error(JSON.stringify({ event: 'migration_score_skipped', migration: '20260815_normalize_scores_to_numbers', score_id: String(score._id), raw_value: score.score }));
          skipped.push(String(score._id));
          continue;
        }
        await scores.updateOne({ _id: score._id, score: score.score }, { $set: { score: numericScore } });
        migrated += 1;
      }
      return { migrated, skipped };
    },
  },
  {
    // Found by live-testing the payment approval UI, not by reading code:
    // approving a second pending signup threw a real MongoServerError
    // (E11000 duplicate key on stripe_session_id_1, dup key { null }).
    // pendingorgsignups predates the Tilopay migration -- it used to have
    // a unique stripe_session_id field, since replaced by payment_reference
    // (models/pendingOrgSignup.js has no stripe_session_id at all anymore).
    // Mongoose only ever ADDS indexes for fields the current schema
    // declares; it never drops one that's no longer declared, so this
    // stale unique index survives forever on any database that existed
    // before the migration -- and since every document without the field
    // gets the same `null` value, a non-sparse unique index on it means
    // at most ONE pending signup can ever exist at a time. A brand-new
    // deployment (empty volume) never creates this index in the first
    // place, so this only matters for upgrading an already-running
    // database -- exactly the case this migration exists for.
    id: '20260823_drop_stale_stripe_session_id_index',
    async run(db) {
      // Bug found running this migration against a genuinely brand-new,
      // never-written-to database (found while verifying a later,
      // unrelated round of fixes end to end): listIndexes() throws
      // "ns does not exist" (NamespaceNotFound) on a collection that was
      // never created -- not just "no documents", the collection
      // namespace itself doesn't exist until something first writes to
      // it. The comment above ("a brand-new deployment never creates
      // this index") was correct about the index, but missed that the
      // collection itself might not exist either on a database this
      // fresh. Caught specifically (not a blanket catch-and-continue) so
      // any other real failure still surfaces instead of being silently
      // swallowed.
      const collection = db.collection('pendingorgsignups');
      let indexes;
      try {
        indexes = await collection.listIndexes().toArray();
      } catch (error) {
        if (error.codeName === 'NamespaceNotFound' || error.code === 26) {
          return { dropped: false, reason: 'collection not present' };
        }
        throw error;
      }
      const stale = indexes.find(index => index.name === 'stripe_session_id_1');
      if (!stale) return { dropped: false, reason: 'index not present' };
      await collection.dropIndex('stripe_session_id_1');
      return { dropped: true };
    },
  },
  {
    // Security fix, found live during an audit round: selfServiceSignup.js
    // used to decide "is this plan free?" by checking `!price_cents`, so
    // on any database created before this fix, every plan (including
    // Enterprise, with unlimited limits) had price_cents: null and was
    // therefore silently free -- self-signup for Enterprise with no
    // payment was reproduced live against this exact database shape.
    // plan_schema.js now has an explicit `is_free` field the app trusts
    // instead, but Mongoose's schema `default` only applies when a field
    // is entirely absent, and only ever to the SAME value for every
    // document -- it can't retroactively make just the Free plan true.
    // This migration sets that explicitly, once, on any database that
    // already has these four plan documents from before this fix.
    id: '20260824_add_plan_is_free_flag',
    async run(db) {
      const plans = db.collection('plans');
      const freeResult = await plans.updateMany(
        { name: 'Free', is_free: { $ne: true } },
        { $set: { is_free: true } }
      );
      const othersResult = await plans.updateMany(
        { name: { $ne: 'Free' }, is_free: { $exists: false } },
        { $set: { is_free: false } }
      );
      return {
        free_plan_updated: freeResult.modifiedCount,
        other_plans_defaulted: othersResult.modifiedCount,
      };
    },
  },
  {
    // HIGH-02 fix: seat_count is the new atomic reservation counter for
    // middleware/enforcePlanLimits.js's user-limit check (see
    // organization_schema.js's comment on the field for why). Backfilled
    // here, once, from the REAL current Users count for every existing
    // organization -- so it starts out accurate rather than at the
    // schema's own `default: 0`, which would otherwise let every
    // already-at-or-over-limit organization's next signup slip through
    // once (undercounting) until it happened to be corrected some other
    // way. Organizations created after this migration get seat_count
    // starting at 0 from the schema default, which is correct since they
    // have zero users at creation time.
    id: '20260827_backfill_organization_seat_count',
    async run(db) {
      const organizations = db.collection('organizations');
      const users = db.collection('users');
      const cursor = organizations.find({ seat_count: { $exists: false } });
      let updated = 0;
      for await (const org of cursor) {
        const count = await users.countDocuments({ organization_code: org.organization_code });
        await organizations.updateOne({ _id: org._id }, { $set: { seat_count: count } });
        updated += 1;
      }
      return { organizations_backfilled: updated };
    },
  },
  {
    // A legacy platform administrator profile was created before the
    // Organization document for EBADGEID-PLATFORM existed. That left the
    // profile usable for login but gave the company/signature settings no
    // data record to read or save. Create it once, only when the matching
    // profile exists, and never overwrite a real company record.
    id: '20260827_ensure_ebadgeid_platform_organization',
    async run(db) {
      const organizations = db.collection('organizations');
      const users = db.collection('users');
      const organization_code = 'EBADGEID-PLATFORM';
      const existing = await organizations.findOne({ organization_code });
      if (existing) return { created: false, reason: 'organization already exists' };

      const profile = await users.findOne({ organization_code });
      if (!profile) return { created: false, reason: 'platform profile not found' };

      const seat_count = await users.countDocuments({ organization_code });
      await organizations.insertOne({
        organization_code,
        name: 'eBadgeID',
        city: profile.city || 'Not configured',
        state: profile.state || 'Not configured',
        country: profile.country || 'Not configured',
        email: profile.email || 'info@ebadgeid.com',
        phone: profile.phone || 'Not configured',
        status: 'ACTIVE',
        plan: 'Free',
        users: seat_count,
        seat_count,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      return { created: true, organization_code, seat_count };
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
    const completed = await records.findOne({ id: migration.id });
    if (completed) continue;
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
