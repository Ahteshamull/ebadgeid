// services/dashboardMetricsService.js
//
// E2E audit H-23: three separate dashboard implementations
// (controllers/overviewController.js, routes/organization_dashboard.js,
// routes/user_dash_algorithm.js) each reimplemented, and subtly diverged
// on, the same underlying computations -- organization-scoped credential
// counts/aggregates and score-based user ranking. Each endpoint's RESPONSE
// SHAPE stays its own (different frontends depend on each contract); only
// the shared computation moves here so there's exactly one place that
// knows how to correctly scope and aggregate these numbers.
//
// Every function here scopes by Credentials/Score's own `organization_code`
// field directly (denormalized onto both schemas), never by joining
// through `achiever_username`/`username` against a list of the org's real
// users -- that join pattern is the exact bug class already fixed as
// SEC-AUDIT-1 / H-01 / H-10: a guest credential or score recorded by a
// DIFFERENT organization can carry the same free-text username as a real
// user here, so matching on the name alone (instead of organization_code)
// leaks another org's data into this one's dashboard.
const Users = require('../models/user_model');
const Credentials = require('../models/credentialSchema');
const Score = require('../models/score_schema');

async function getOrgUsernames(organization_code) {
  const users = await Users.find({ organization_code }, { username: 1 }).lean();
  return users.map(u => u.username);
}

// Issued/claimed/revoked counts for an organization, optionally narrowed
// further (e.g. to a single month via a credential_issue_date regex).
async function getCredentialTotals(organization_code, extraMatch = {}) {
  const match = { organization_code, ...extraMatch };
  const [issued, claimed, revoked] = await Promise.all([
    Credentials.countDocuments(match),
    Credentials.countDocuments({ ...match, credential_status: 'Claimed' }),
    Credentials.countDocuments({ ...match, credential_status: 'Revoked' }),
  ]);
  return { issued, claimed, revoked };
}

// One aggregate covering every achiever in the org, sorted by credentials
// issued (desc). Callers slice the head (top performers) or tail (least
// performers) instead of each running their own separate aggregate.
async function getCredentialLeaderboard(organization_code) {
  return Credentials.aggregate([
    { $match: { organization_code } },
    {
      $group: {
        _id: '$achiever_username',
        credentials_issued: { $sum: 1 },
        credentials_claimed: { $sum: { $cond: [{ $eq: ['$credential_status', 'Claimed'] }, 1, 0] } },
        credentials_revoked: { $sum: { $cond: [{ $eq: ['$credential_status', 'Revoked'] }, 1, 0] } },
      },
    },
    { $sort: { credentials_issued: -1 } },
  ]);
}

// One aggregate covering every scored user in the org, sorted by total
// score (desc), as [{ _id: username, totalScore }]. Pass
// `includeUsernames` (e.g. every user in the org) to also include users
// with no Score documents at all, at totalScore: 0 -- otherwise a user
// who hasn't completed anything yet simply doesn't appear.
async function getScoreRanking(organization_code, { includeUsernames } = {}) {
  const ranked = await Score.aggregate([
    { $match: { organization_code } },
    { $group: { _id: '$username', totalScore: { $sum: '$score' } } },
  ]);
  if (includeUsernames?.length) {
    const rankedUsernames = new Set(ranked.map(r => r._id));
    for (const username of includeUsernames) {
      if (!rankedUsernames.has(username)) ranked.push({ _id: username, totalScore: 0 });
    }
  }
  ranked.sort((a, b) => b.totalScore - a.totalScore);
  return ranked;
}

module.exports = { getOrgUsernames, getCredentialTotals, getCredentialLeaderboard, getScoreRanking };
