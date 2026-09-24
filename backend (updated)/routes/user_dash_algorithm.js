const express = require('express');
const router = express.Router();
const Credentials = require('../models/credentialSchema');
const Goals = require('../models/goal_schema');
const Score = require('../models/score_schema');
const Users = require('../models/user_model');
const { requireAuth } = require('../middleware/requireAuth');
const { getOrgUsernames, getScoreRanking } = require('../services/dashboardMetricsService');

// Only the user themself or an org admin can see this user's performance data.
const requireSelfOrAdmin = (req, res, next) => {
  if (req.user.role === 'admin' || req.user.username === req.params.username) {
    return next();
  }
  return res.status(403).json({ message: 'Not allowed to view another user\'s performance data' });
};

// Helper function to get current month and year
function getCurrentMonthYear() {
    const date = new Date();
    return {
        month: date.getMonth() + 1,
        year: date.getFullYear()
    };
}

// Helper function to get dates for the current week
function getCurrentWeekDates() {
    const now = new Date();
    const dayOfWeek = now.getDay(); // 0 (Sunday) to 6 (Saturday)
    const startDate = new Date(now);
    startDate.setDate(now.getDate() - dayOfWeek);
    
    const endDate = new Date(now);
    endDate.setDate(now.getDate() + (6 - dayOfWeek));
    
    return { start: startDate, end: endDate };
}

// Get user performance metrics
router.get('/:username', requireAuth, requireSelfOrAdmin, async (req, res) => {
    try {
        const { username } = req.params;
        const { month, year } = getCurrentMonthYear();
        const { start: weekStart, end: weekEnd } = getCurrentWeekDates();
        
        // Get user details — scoped to the caller's own organization. Without
        // this, requireSelfOrAdmin only checked req.user.role === 'admin' with
        // no organization comparison, so an admin from ANY organization could
        // pull another organization's user performance data (credentials,
        // goals, ranking) just by knowing a username — a cross-tenant leak.
        // Scoping the lookup by req.user.organization_code closes it: an
        // admin only ever sees users within their own org, and a user viewing
        // themself is unaffected since their own org always matches.
        const user = await Users.findOne({ username, organization_code: req.user.organization_code });
        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }
        
        // SEC-AUDIT-1 (deep technical & security audit, current round): every
        // query below used to filter only by achiever_username/username, with
        // no organization_code — safe for a REAL registered recipient (Users
        // schema enforces a globally-unique username), but not for a GUEST
        // credential, whose achiever_username is free text chosen by whoever
        // issues it (see credentialController.createCredential) and is only
        // checked for a collision against real Users of the ISSUING org, never
        // against other organizations. Confirmed for real, not theoretically:
        // organization A had a real user "audit_collision_user"; organization
        // B issued a guest credential to a recipient also named
        // "audit_collision_user"; organization A's admin, viewing that real
        // user's own dashboard, saw organization B's credential mixed into
        // their achievements, monthly progress, and credential-type charts.
        // The one-line org fix already applied to the `user` lookup itself
        // (see the comment above) did not extend to any of the 7 queries
        // below — this closes all of them the same way. Same fix applied to
        // the Score aggregate in step 4: Score.username is likewise free text
        // an admin supplies when recording a score (scoreController.js has no
        // check that it matches a real user), so the same cross-org mixing
        // was possible for ranking, not just credentials.
        const orgScope = { organization_code: user.organization_code };

        // 1. Credentials this month
        const credentialsThisMonth = await Credentials.countDocuments({
            achiever_username: username,
            ...orgScope,
            $expr: {
                $and: [
                    { $eq: [{ $month: "$createdAt" }, month] },
                    { $eq: [{ $year: "$createdAt" }, year] }
                ]
            }
        });

        // 2. Success ratio (credentials achieved vs total available goals)
        const totalGoals = await Goals.countDocuments({ organization_code: user.organization_code });
        const achievedCredentials = await Credentials.countDocuments({ achiever_username: username, ...orgScope });
        const successRatio = totalGoals > 0 ? (achievedCredentials / totalGoals) * 100 : 0;

        // 3. Average process time (assuming createdAt field exists in Credentials)
        const credentialTimes = await Credentials.aggregate([
            { $match: { achiever_username: username, ...orgScope } },
            {
                $group: {
                    _id: null,
                    avgProcessTime: { $avg: { $subtract: ["$updatedAt", "$createdAt"] } }
                }
            }
        ]);
        const avgProcessTime = credentialTimes.length > 0 ? credentialTimes[0].avgProcessTime : 0;

        // 4. Organizational ranking (E2E audit H-23: shared with
        // routes/organization_dashboard.js's own ranking via
        // dashboardMetricsService). This used to run one Mongo round trip
        // PER user in the org (Promise.all over every member) just to rank
        // a single user -- now it's one aggregate for the whole org.
        // `includeUsernames` keeps the original behavior of ranking every
        // org member, including anyone with zero completions so far (a
        // plain Score aggregate alone would simply omit them).
        const allUsernames = await getOrgUsernames(user.organization_code);
        const ranking = await getScoreRanking(user.organization_code, { includeUsernames: allUsernames });
        const myRanking = ranking.findIndex(u => u._id === username) + 1;

        // 5. Monthly progress (chart ready data)
        const monthlyProgress = await Credentials.aggregate([
            { $match: { achiever_username: username, ...orgScope } },
            {
                $group: {
                    _id: {
                        month: { $month: "$createdAt" },
                        year: { $year: "$createdAt" }
                    },
                    count: { $sum: 1 }
                }
            },
            { $sort: { "_id.year": 1, "_id.month": 1 } },
            { $limit: 12 } // Last 12 months
        ]);

        // 6. Credential types
        const credentialTypes = await Credentials.aggregate([
            { $match: { achiever_username: username, ...orgScope } },
            {
                $group: {
                    _id: "$credential_type", // You might want to add this field to your schema
                    count: { $sum: 1 }
                }
            }
        ]);

        // 7. Weekly performance (bar chart ready data)
        const weeklyPerformance = await Credentials.aggregate([
            {
                $match: {
                    achiever_username: username,
                    ...orgScope,
                    createdAt: { $gte: weekStart, $lte: weekEnd }
                }
            },
            {
                $group: {
                    _id: { $dayOfWeek: "$createdAt" },
                    count: { $sum: 1 }
                }
            }
        ]);

        // 8. Achievements (all credentials with details)
        const achievements = await Credentials.find({ achiever_username: username, ...orgScope })
            .sort({ createdAt: -1 });
        
        // Prepare response
        const response = {
            user: {
                username: user.username,
                name: `${user.first_name} ${user.last_name}`,
                organization: user.organization_code
            },
            metrics: {
                credentials_this_month: credentialsThisMonth,
                success_ratio: successRatio.toFixed(2),
                avg_process_time: avgProcessTime,
                my_ranking: myRanking
            },
            charts: {
                monthly_progress: monthlyProgress.map(m => ({
                    month: m._id.month,
                    year: m._id.year,
                    count: m.count
                })),
                credential_types: credentialTypes.map(t => ({
                    type: t._id,
                    count: t.count
                })),
                weekly_performance: Array(7).fill(0).map((_, i) => {
                    const dayData = weeklyPerformance.find(w => w._id === i+1);
                    return {
                        day: i+1,
                        count: dayData ? dayData.count : 0
                    };
                })
            },
            achievements: achievements
        };
        
        res.json(response);
        
    } catch (error) {
        console.error('Error fetching performance data:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
});

module.exports = router;