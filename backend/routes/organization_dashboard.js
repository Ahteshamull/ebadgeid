const express = require('express');
const router = express.Router();
const Credentials = require('../models/credentialSchema');
const Users = require('../models/user_model');
const Score = require('../models/score_schema');
const { requireAuth, requireOwnOrg } = require('../middleware/requireAuth');
const { getScoreRanking } = require('../services/dashboardMetricsService');

const STATUS_NAMES = ['Issued', 'Claimed', 'Expired', 'Revoked'];

router.get('/:organization_code', requireAuth, requireOwnOrg('organization_code'), async (req, res) => {
    try {
        const { organization_code } = req.params;

        const [totalEmployees, statusRows, trendRows, scoreStats, userScores] = await Promise.all([
            Users.countDocuments({ organization_code }),
            Credentials.aggregate([
                { $match: { organization_code } },
                { $group: { _id: '$credential_status', count: { $sum: 1 } } },
            ]),
            Credentials.aggregate([
                { $match: { organization_code, createdAt: { $type: 'date' } } },
                {
                    $group: {
                        _id: { $dateToString: { format: '%Y-%m', date: '$createdAt' } },
                        count: { $sum: 1 },
                    },
                },
                { $sort: { _id: 1 } },
            ]),
            Score.aggregate([
                { $match: { organization_code } },
                { $group: { _id: null, average: { $avg: '$score' } } },
            ]),
            getScoreRanking(organization_code),
        ]);

        const statusCounts = Object.fromEntries(STATUS_NAMES.map((name) => [name, 0]));
        for (const row of statusRows) {
            if (STATUS_NAMES.includes(row._id)) statusCounts[row._id] = row.count;
        }
        const totalCredentialsIssued = STATUS_NAMES.reduce((sum, name) => sum + statusCounts[name], 0);
        const claimedCredentials = statusCounts.Claimed;
        const revokedCredentials = statusCounts.Revoked;
        const activeCredentials = totalCredentialsIssued - revokedCredentials;
        const verificationRate = totalCredentialsIssued > 0
            ? (claimedCredentials / totalCredentialsIssued * 100).toFixed(1)
            : '0.0';

        const monthlySeries = trendRows.map((row) => ({ date: row._id, count: row.count }));
        const averageScore = typeof scoreStats[0]?.average === 'number' ? scoreStats[0].average : 0;

        const topPerformer = userScores[0] || null;
        const leastPerformer = userScores.length > 1 ? userScores[userScores.length - 1] : null;

        const [topPerformerCreds, leastPerformerCreds] = await Promise.all([
            topPerformer
                ? Credentials.countDocuments({ achiever_username: topPerformer._id, organization_code })
                : 0,
            leastPerformer
                ? Credentials.countDocuments({ achiever_username: leastPerformer._id, organization_code })
                : 0,
        ]);

        res.json({
            total_employees: totalEmployees,
            avg_score: Number(averageScore.toFixed(1)),
            avg_productivity: `${averageScore.toFixed(1)}%`,
            organization_growth: monthlySeries,
            total_credentials_issued: totalCredentialsIssued,
            verification_rate: `${verificationRate}%`,
            active_credentials: activeCredentials,
            revoked_credentials: revokedCredentials,
            credential_status_breakdown: STATUS_NAMES.map((name) => ({ name, value: statusCounts[name] })),
            credential_issuance_trend: monthlySeries,
            top_performing_employee: topPerformer ? {
                username: topPerformer._id,
                score: topPerformer.totalScore,
                issued_credentials: topPerformerCreds,
            } : null,
            least_performing_employee: leastPerformer ? {
                username: leastPerformer._id,
                score: leastPerformer.totalScore,
                issued_credentials: leastPerformerCreds,
            } : null,
            employee_performance_comparison: userScores.slice(0, 10).map((user) => ({
                username: user._id,
                score: user.totalScore,
            })),
        });
    } catch (error) {
        console.error('Error fetching analytics:', error);
        res.status(500).json({ message: 'Unable to load organization analytics' });
    }
});

module.exports = router;
