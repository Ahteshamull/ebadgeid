const express = require('express');
const router = express.Router();
const Credentials = require('../models/credentialSchema');
const Goals = require('../models/goal_schema');
const Users = require('../models/user_model');
const Score = require('../models/score_schema');
const Completion = require('../models/task_completion');
const Organization = require('../models/organization_schema');
const { requireAuth, requireOwnOrg } = require('../middleware/requireAuth');
const { getScoreRanking } = require('../services/dashboardMetricsService');

// Analytics endpoint
router.get('/:organization_code', requireAuth, requireOwnOrg('organization_code'), async (req, res) => {
    try {
        const { organization_code } = req.params;

        // 1. Total Employees
        const totalEmployees = await Users.countDocuments({ organization_code });

        // 2. Avg Productivity (based on scores)
        const scores = await Score.find({ organization_code });
        const totalScore = scores.reduce((sum, score) => sum + parseFloat(score.score), 0);
        const avgProductivity = totalScore / (scores.length || 1);

        // Note: employee satisfaction and avg processing time were removed
        // from here — the previous code faked them (Math.random() for
        // "satisfaction", a hardcoded "2.5 days" for processing time) with
        // no real data source behind either. Returning fabricated numbers
        // in an analytics endpoint is worse than not showing the metric at
        // all — an admin making a decision off a made-up number has no way
        // to know it's fake. If these metrics matter, they need a real data
        // source first (a satisfaction survey schema; timestamps linking a
        // task completion to its resulting credential issuance).

        // 4. Organization Growth (chart data - credentials issued over time)
        // E2E audit H-23: this used to scope by `achiever_username: { $in:
        // usernames }` (usernames of this org's real Users) instead of
        // `organization_code` directly on Credentials -- the same unsafe
        // name-based org matching already fixed elsewhere as H-01/H-10. A
        // guest credential issued by a DIFFERENT organization, whose
        // free-text achiever_username happens to collide with a real
        // username here, was being counted into this organization's
        // growth/issuance/verification numbers. `organization_code` is a
        // required, denormalized field on every Credential document, so
        // scoping by it directly is both simpler and correct.
        const credentials = await Credentials.find({ organization_code });
        // Computed once and reused for both the growth chart and the
        // issuance trend below -- they used to be the exact same reduce
        // run twice over the exact same data.
        const monthlyBreakdown = credentials.reduce((acc, cred) => {
            const date = new Date(cred.createdAt);
            const monthYear = `${date.getFullYear()}-${date.getMonth() + 1}`;
            acc[monthYear] = (acc[monthYear] || 0) + 1;
            return acc;
        }, {});
        const monthlyGrowth = monthlyBreakdown;
        const credentialTrend = monthlyBreakdown;

        // 5. Credential Metrics
        const totalCredentialsIssued = credentials.length;
        const claimedCredentials = credentials.filter(c => c.credential_status === 'Claimed').length;
        const verificationRate = totalCredentialsIssued > 0
            ? (claimedCredentials / totalCredentialsIssued * 100).toFixed(1)
            : '0.0';
        const activeCredentials = credentials.filter(c => c.credential_status !== 'Revoked').length;
        const revokedCredentials = credentials.filter(c => c.credential_status === 'Revoked').length;

        // 7. Employee Performance (E2E audit H-23: shared with
        // user_dash_algorithm.js's per-user ranking via dashboardMetricsService)
        const userScores = await getScoreRanking(organization_code);

        const topPerformer = userScores[0] || null;
        const leastPerformer = userScores[userScores.length - 1] || null;

        // Get credentials for top and least performers -- scoped by
        // organization_code too now (H-23), for the same reason as above.
        const topPerformerCreds = topPerformer ?
            await Credentials.countDocuments({ achiever_username: topPerformer._id, organization_code }) : 0;
        const leastPerformerCreds = leastPerformer ?
            await Credentials.countDocuments({ achiever_username: leastPerformer._id, organization_code }) : 0;

        // avg_processing_time removed for the same reason — no real
        // timestamp link between task completion and credential issuance
        // exists yet to compute it honestly.

        // 9. Employee Performance Comparison (for bar chart)
        const performanceComparison = userScores.slice(0, 10).map(user => ({
            username: user._id,
            score: user.totalScore
        }));

        // Prepare the response
        const analytics = {
            total_employees: totalEmployees,
            avg_productivity: `${avgProductivity.toFixed(1)}%`,
            organization_growth: Object.entries(monthlyGrowth).map(([date, count]) => ({ date, count })),
            total_credentials_issued: totalCredentialsIssued,
            verification_rate: `${verificationRate}%`,
            active_credentials: activeCredentials,
            revoked_credentials: revokedCredentials,
            credential_issuance_trend: Object.entries(credentialTrend).map(([date, count]) => ({ date, count })),
            top_performing_employee: topPerformer ? {
                username: topPerformer._id,
                score: topPerformer.totalScore,
                issued_credentials: topPerformerCreds
            } : null,
            least_performing_employee: leastPerformer ? {
                username: leastPerformer._id,
                score: leastPerformer.totalScore,
                issued_credentials: leastPerformerCreds
            } : null,
            employee_performance_comparison: performanceComparison
        };

        res.json(analytics);
    } catch (error) {
        console.error('Error fetching analytics:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

module.exports = router;