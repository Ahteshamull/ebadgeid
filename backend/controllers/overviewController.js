// controllers/overview.controller.js
const Users = require("../models/user_model");
const Credentials = require("../models/credentialSchema");
const DigitalContract = require("../models/digitalContract");
const Organization = require("../models/organization_schema");
const Goals = require("../models/goal_schema");
const Completion = require("../models/task_completion");
const Score = require("../models/score_schema");
const { getCredentialTotals, getCredentialLeaderboard } = require("../services/dashboardMetricsService");

exports.getOrganizationOverview = async (req, res) => {
    try {
        const { organization_code } = req.params;

        // 1. Check org exists
        const org = await Organization.findOne({ organization_code });
        if (!org) {
            return res.status(404).json({ message: "Organization not found" });
        }

        // ---------------------------------------------------------------------
        // EMPLOYEES
        // ---------------------------------------------------------------------
        const totalEmployees = await Users.countDocuments({ organization_code });
        const activeEmployees = await Users.countDocuments({ organization_code, status: "Active" });

        // ---------------------------------------------------------------------
        // CONTRACTS
        // ---------------------------------------------------------------------
        const totalContracts = await DigitalContract.countDocuments({ organization_code });
        const activeContracts = await DigitalContract.countDocuments({
            organization_code,
            contract_status: "active"
        });
        const disputedContracts = await DigitalContract.countDocuments({
            organization_code,
            contract_status: "disputed"
        });
        const inDiscussionContracts = await DigitalContract.countDocuments({
            organization_code,
            contract_status: "in_discussion"
        });

        // ---------------------------------------------------------------------
        // CREDENTIALS (E2E audit H-23: shared logic, see dashboardMetricsService)
        // ---------------------------------------------------------------------
        // `organization_code` is a required, denormalized field on every
        // Credential document -- the old `$or` fallback through
        // `organization_detail.code`/`organization_detail.organization_code`/
        // `achiever_username` predates that and is both unnecessary and, for
        // the achiever_username branch, the same unsafe name-based org
        // matching already fixed elsewhere as H-01/H-10 (a guest credential
        // from a different org can carry the same free-text name as a real
        // user here).
        const { issued: issuedTotal, claimed: claimedTotal, revoked: revokedTotal } = await getCredentialTotals(organization_code);

        // Monthly (based on credential_issue_date which is a STRING → fixable)
        const thisMonthStr = new Date().toISOString().slice(0, 7); // "2025-12"

        const {
            issued: issuedThisMonth,
            claimed: claimedThisMonth,
            revoked: revokedThisMonth,
        } = await getCredentialTotals(organization_code, { credential_issue_date: { $regex: thisMonthStr } });

        const unclaimedThisMonth = issuedThisMonth - claimedThisMonth;

        // ---------------------------------------------------------------------
        // MONTHLY CONTRACT CHART (LINE) - credentials issued/claimed per month
        // ---------------------------------------------------------------------
        const year = new Date().getFullYear();
        const monthKeys = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
        const monthly_contract_chart = { chart_type: 'LINE' };

        for (let m = 1; m <= 12; m++) {
            const mm = String(m).padStart(2, '0');
            const prefix = `${year}-${mm}`; // matches credential_issue_date starting with YYYY-MM

            const { issued: issuedCount, claimed: claimedCount } = await getCredentialTotals(
                organization_code,
                { credential_issue_date: { $regex: `^${prefix}` } }
            );

            monthly_contract_chart[`credentials_issued_${monthKeys[m - 1]}`] = issuedCount;
            monthly_contract_chart[`credentials_claimed_${monthKeys[m - 1]}`] = claimedCount;
        }

        // ---------------------------------------------------------------------
        // TOP 5 EMPLOYEES
        // ---------------------------------------------------------------------
        const topEmployeesAgg = (await getCredentialLeaderboard(organization_code)).slice(0, 5);
        // Attach user profile info
        const topEmployees = [];
        for (let emp of topEmployeesAgg) {
            const u = await Users.findOne({ username: emp._id, organization_code });

            if (!u) continue;

            topEmployees.push({
                name: `${u.first_name} ${u.last_name}`,
                profile_pic: u.profile_picture_url || "",
                designation: u.designation,
                credentials_issued: emp.credentials_issued,
                credentials_claimed: emp.credentials_claimed,
                credentials_revoked: emp.credentials_revoked
            });
        }

        // ---------------------------------------------------------------------
        // FINAL RESPONSE
        // ---------------------------------------------------------------------

        return res.json({
            sync_on: new Date().toDateString(),
            total_employees: totalEmployees,
            active_employees: activeEmployees,
            total_contract: totalContracts,
            active_contract: activeContracts,
            credentials_issued: issuedTotal,
            credential_claimed: claimedTotal,

            charts: [
                {
                    monthly_credential_charts: {
                        credential_issued_this_month: issuedThisMonth,
                        credentials_claimed_this_month: claimedThisMonth,
                        credentials_revoked_this_month: revokedThisMonth,
                        credentials_unclaimed: unclaimedThisMonth,
                        chart_type: "PIE"
                    },

                    contract_summary: {
                        chart_type: "PIE",
                        total_contracts: totalContracts,
                        contracts_active: activeContracts,
                        contracts_disputed: disputedContracts,
                        contract_in_discussion: inDiscussionContracts
                    }
                    ,
                    monthly_contract_chart: monthly_contract_chart
                }
            ],

            employees_overview: [
                {
                    top_five_employees: topEmployees
                }
            ]
        });

    } catch (err) {
        console.error(err);
        res.status(500).json({ message: err.message });
    }
};

exports.getEmployeeOverview = async (req, res) => {
  try {
    const { organization_code, username } = req.params;

    // -----------------------------------------------------
    // 1. Fetch User
    // -----------------------------------------------------
    const user = await Users.findOne({ username, organization_code });
    if (!user) {
      return res.status(404).json({ status: "error", message: "Employee not found" });
    }

    // Greeting message
    const message = `Good Evening, ${user.first_name} ${user.last_name}`;

    // -----------------------------------------------------
    // 2. Credentials issued by this employee
    // -----------------------------------------------------
    // SEC-AUDIT-E2E-H01: achiever_username alone is not a safe scope --
    // a guest_recipient credential issued by a DIFFERENT organization can
    // carry the exact same free-text name as a real employee here (see
    // credentialController.createCredential's guest_recipient path, and
    // the identical real-world reproduction already fixed for this same
    // reason in routes/user_dash_algorithm.js). organization_code is
    // already validated against req.user by requireOwnOrg() on this
    // route, so it's a safe, authoritative scope to add here too.
    const credentialsIssued = await Credentials.countDocuments({
      achiever_username: username,
      organization_code
    });

    const credentialsClaimed = await Credentials.countDocuments({
      achiever_username: username,
      credential_status: "Claimed",
      organization_code
    });

    // -----------------------------------------------------
    // 3. Recent Achievements (3 latest credentials)
    // -----------------------------------------------------
    const recentAchievements = await Credentials.find(
      { achiever_username: username, organization_code },
      {
        credential_title: 1,
        credential_issue_date: 1,
        credential_status: 1,
        badge_icon_url: 1
      }
    )
      .sort({ credential_issue_date: -1 })
      .limit(3);

    // -----------------------------------------------------
    // 4. Goals Overview (via Score table)
    // -----------------------------------------------------
    const orgGoals = await Goals.find({ organization_code });

    let activeGoals = 0;
    let completedGoals = 0;

    for (let g of orgGoals) {
      const scoreDoc = await Score.findOne({
        organization_code,
        goal_code: g.goal_code,
        username
      });

      const scoreValue = scoreDoc ? parseInt(scoreDoc.score) : 0;

      if (scoreValue >= g.qualifying_score) {
        completedGoals++;
      } else {
        activeGoals++;
      }
    }

    // -----------------------------------------------------
    // 5. Star Employee (best performer in the organization)
    // -----------------------------------------------------
    // SEC-AUDIT-E2E-H10: was an unscoped platform-wide match -- scanned
    // every organization's Credentials and could pick a top achiever who
    // isn't even a member of this organization (silently producing an
    // empty/wrong star_employee below, since the Users lookup afterward
    // was already, correctly, organization_code-scoped). Scoping the
    // match here is both the security fix (H-01's class of bug) and the
    // correctness fix (H-10) in one place.
    const starAgg = await Credentials.aggregate([
      { $match: { organization_code } },
      {
        $group: {
          _id: "$achiever_username",
          total: { $sum: 1 }
        }
      },
      { $sort: { total: -1 } },
      { $limit: 1 }
    ]);

    let starEmployee = {
      name: "",
      designation: "",
      profile_picture: ""
    };

    if (starAgg.length > 0) {
      const topUser = await Users.findOne({ username: starAgg[0]._id, organization_code });
      if (topUser) {
        starEmployee = {
          name: `${topUser.first_name} ${topUser.last_name}`,
          designation: topUser.designation,
          profile_picture: topUser.profile_picture_url || ""
        };
      }
    }

    // -----------------------------------------------------
    // 6. Final Response
    // -----------------------------------------------------
    return res.json({
      status: "success",
      call: "Employee Overview",
      message,
      credentials_issued: credentialsIssued,
      credentials_claimed: credentialsClaimed,
      active_goals: activeGoals,
      completed_goals: completedGoals,
      recent_achievements: recentAchievements,
      star_employee: starEmployee
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ status: "error", message: err.message });
  }
};
