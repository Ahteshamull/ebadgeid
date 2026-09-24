// services/organizationPurgeService.js
//
// E2E audit H-22 follow-up: deleteOrganization only ever soft-deletes
// (status: 'DELETED' + deleted_at, see controllers/organizationController.js)
// -- by explicit product decision, the data is kept around for a
// retention window in case a delete needs to be undone or audited.
// This is the other half of that decision: after PURGE_RETENTION_DAYS
// have passed, an organization's data is gone for real, everywhere it
// exists in the database. This never runs against an organization that
// isn't already soft-deleted, and it never runs manually/on demand --
// only the scheduled job in queues/scheduledJobsWorker.js calls it, on
// the schedule configured in queues/scheduledJobsQueue.js.
const fs = require('fs/promises');
const path = require('path');
const mongoose = require('mongoose');
const logger = require('../utils/logger');

const Organization = require('../models/organization_schema');
const Users = require('../models/user_model');
const Auth = require('../models/AuthCredentials');
const Notifications = require('../models/notificationsSchema');
const DigitalContract = require('../models/digitalContract');
const ContractAccess = require('../models/contractAccess');
const DesignShare = require('../models/designShare');

const ApiKey = require('../models/api_keys');
const AuditLog = require('../models/auditLog');
const BulkIssuanceApproval = require('../models/bulkIssuanceApproval');
const Credentials = require('../models/credentialSchema');
const CredentialVerificationLogs = require('../models/credentialVerificationLog');
const DesignComment = require('../models/designComment');
const Designs = require('../models/designSchema');
const DesignVersion = require('../models/designVersion');
const Goals = require('../models/goal_schema');
const Invitation = require('../models/invitation_schema');
const LmsSyncLog = require('../models/lmsSyncLog');
const LmsWebhookEvents = require('../models/lmsWebhookEvent');
const OrganizationAsset = require('../models/organizationAsset');
const OrganizationBrandKit = require('../models/organizationBrandKit');
const OrganizationLmsConfig = require('../models/organizationLmsConfig');
const OrganizationSamlConfig = require('../models/organizationSamlConfig');
const PendingOrgSignup = require('../models/pendingOrgSignup');
const Score = require('../models/score_schema');
const Completion = require('../models/task_completion');
const UsageCounter = require('../models/usageCounter');

// Every collection scoped directly by an `organization_code` field.
// DesignShare, Auth, Notifications, and ContractAccess are handled
// separately below because none of them are keyed by organization_code.
const ORG_SCOPED_MODELS = [
  ApiKey, AuditLog, BulkIssuanceApproval, Credentials, CredentialVerificationLogs,
  DesignComment, Designs, DesignVersion, DigitalContract, Goals, Invitation,
  LmsSyncLog, LmsWebhookEvents, OrganizationAsset, OrganizationBrandKit,
  OrganizationLmsConfig, OrganizationSamlConfig, PendingOrgSignup, Score,
  Completion, UsageCounter, Users,
];

// Same directories controllers/uploadController.js writes to -- purging
// an organization's database rows without also deleting the physical
// files those rows pointed at left every logo, background, and signed
// contract PDF orphaned on disk forever (found during an audit round;
// the header comment above already claimed "gone for real, everywhere it
// exists", which was only true for MongoDB).
const UPLOAD_DIR = path.join(__dirname, '..', 'uploads');
const PRIVATE_CONTRACT_DIR = process.env.PRIVATE_CONTRACT_UPLOAD_DIR || path.join(__dirname, '..', 'private-contracts');

// Best-effort: a file that's already gone (or was never actually written,
// e.g. a row created but the disk write failed) must never fail or
// half-abort the purge -- the database transaction above is the
// authoritative, all-or-nothing record; this cleans up what it can find.
async function deleteFileIfExists(directory, urlOrFilename) {
  if (!urlOrFilename) return false;
  const filename = path.basename(String(urlOrFilename).split(/[?#]/)[0]);
  if (!filename || filename === '.' || filename === '..') return false;
  try {
    await fs.unlink(path.join(directory, filename));
    return true;
  } catch (error) {
    if (error.code !== 'ENOENT') {
      logger.error('organization_purge_file_delete_failed', { directory, filename, message: error.message });
    }
    return false;
  }
}

async function purgePhysicalFiles(organization_code, { assetUrls, brandKitLogoUrl, signedContractUrls }) {
  let deleted = 0;
  for (const url of assetUrls) {
    if (await deleteFileIfExists(UPLOAD_DIR, url)) deleted += 1;
  }
  if (await deleteFileIfExists(UPLOAD_DIR, brandKitLogoUrl)) deleted += 1;
  for (const url of signedContractUrls) {
    if (await deleteFileIfExists(PRIVATE_CONTRACT_DIR, url)) deleted += 1;
  }
  logger.info('organization_purge_files_deleted', { organization_code, deleted, considered: assetUrls.length + signedContractUrls.length + (brandKitLogoUrl ? 1 : 0) });
  return deleted;
}

// The single place this window is configured -- see PRODUCTION_RUNBOOK.md's
// "Cron / trabajos programados" section for how to change it.
const PURGE_RETENTION_DAYS = 90;

// Purges exactly one organization's data, everywhere. Real transaction
// (requires the replica-set MongoDB this project already runs) so this
// either fully completes or fully rolls back -- never a half-purged
// organization with some collections cleared and others not.
async function purgeOrganization(organization_code) {
  const usernames = (await Users.find({ organization_code }, { username: 1 }).lean()).map((u) => u.username);
  const emails = [...new Set(
    (await Users.find({ organization_code }, { email: 1 }).lean()).map((u) => u.email).filter(Boolean),
  )];
  const contractCodes = (await DigitalContract.find({ organization_code }, { contract_code: 1 }).lean()).map((c) => c.contract_code);

  // Captured before the transaction deletes the rows that reference them --
  // used to clean up the physical files afterward (see purgePhysicalFiles).
  const assetUrls = (await OrganizationAsset.find({ organization_code }, { url: 1 }).lean()).map((a) => a.url);
  const brandKit = await OrganizationBrandKit.findOne({ organization_code }, { logo_url: 1 }).lean();
  const contractsWithSignedCopies = await DigitalContract.find({ organization_code }, { signed_copies: 1 }).lean();
  const signedContractUrls = contractsWithSignedCopies.flatMap((c) => (c.signed_copies || []).map((s) => s.signed_copy_url).filter(Boolean));

  const session = await mongoose.startSession();
  const deletedCounts = {};
  try {
    await session.withTransaction(async () => {
      for (const Model of ORG_SCOPED_MODELS) {
        const result = await Model.deleteMany({ organization_code }, { session });
        deletedCounts[Model.modelName] = result.deletedCount;
      }

      const shareResult = await DesignShare.deleteMany(
        { $or: [{ source_organization_code: organization_code }, { target_organization_code: organization_code }] },
        { session },
      );
      deletedCounts.DesignShare = shareResult.deletedCount;

      if (usernames.length) {
        deletedCounts.Auth = (await Auth.deleteMany({ username: { $in: usernames } }, { session })).deletedCount;
      }
      if (emails.length) {
        deletedCounts.Notifications = (await Notifications.deleteMany({ email: { $in: emails } }, { session })).deletedCount;
      }
      if (contractCodes.length) {
        deletedCounts.ContractAccess = (await ContractAccess.deleteMany({ contract_code: { $in: contractCodes } }, { session })).deletedCount;
      }

      // Only ever deletes an organization that is still, at this exact
      // moment, in the DELETED state -- if it was somehow reactivated
      // between being selected for purge and now, this aborts the whole
      // transaction instead of purging an active organization's data.
      const orgResult = await Organization.deleteOne({ organization_code, status: 'DELETED' }, { session });
      if (orgResult.deletedCount !== 1) {
        throw new Error(`Organization ${organization_code} was not in a purgeable state -- aborting`);
      }
    });
  } finally {
    await session.endSession();
  }

  // Only after the database transaction has actually committed -- a file
  // delete has no rollback, so this must never run for an organization
  // whose DB purge itself failed or aborted above.
  const filesDeleted = await purgePhysicalFiles(organization_code, {
    assetUrls,
    brandKitLogoUrl: brandKit?.logo_url,
    signedContractUrls,
  });

  logger.info('organization_purged', { organization_code, deleted_counts: deletedCounts, files_deleted: filesDeleted });
  return { organization_code, deleted_counts: deletedCounts, files_deleted: filesDeleted };
}

// Finds every organization whose soft-delete retention window has
// expired and purges each in turn. One organization failing to purge
// (logged, not thrown) never blocks the others in the same run.
async function purgeExpiredOrganizations() {
  const cutoff = new Date(Date.now() - PURGE_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const eligible = await Organization.find(
    { status: 'DELETED', deleted_at: { $lte: cutoff } },
    { organization_code: 1 },
  ).lean();

  const purged = [];
  for (const org of eligible) {
    try {
      purged.push(await purgeOrganization(org.organization_code));
    } catch (error) {
      logger.error('organization_purge_failed', { organization_code: org.organization_code, message: error.message });
    }
  }
  return { checked: eligible.length, purged: purged.length, results: purged };
}

module.exports = { purgeOrganization, purgeExpiredOrganizations, PURGE_RETENTION_DAYS };
