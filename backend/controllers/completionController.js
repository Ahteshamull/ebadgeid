const mongoose = require('mongoose');
const Completion = require('../models/task_completion'); // your Completion model
const Users = require('../models/user_model'); // your Users model
const Score = require('../models/score_schema');
const logger = require('../utils/logger');
const { sendInAppNotification } = require('../utils/inAppNotification');

function transactionUnsupported(error) {
  const message = `${error?.message || ''} ${error?.errmsg || ''}`;
  return error?.code === 20 || /replica set|Transaction numbers are only allowed/i.test(message);
}

async function approveCompletionRecord(id, organizationCode, session) {
  const completionQuery = Completion.findOne({
    _id: id,
    organization_code: organizationCode,
    status: { $ne: 'approved' },
  });
  if (session) completionQuery.session(session);
  const completion = await completionQuery;
  if (!completion) {
    const existingQuery = Completion.findOne({ _id: id, organization_code: organizationCode });
    if (session) existingQuery.session(session);
    const existing = await existingQuery;
    if (!existing) throw Object.assign(new Error('Completion not found'), { statusCode: 404 });
    throw Object.assign(new Error('This task was already approved'), { statusCode: 400 });
  }

  const { username, organization_code, goal_code } = completion;
  const scoreDoc = await Score.findOneAndUpdate(
    { username, organization_code, goal_code },
    { $inc: { score: 10 } },
    { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true, ...(session ? { session } : {}) },
  );
  completion.status = 'approved';
  await completion.save(session ? { session } : undefined);
  return { scoreDoc, username, goal_code };
}

exports.approveCompletion = async (req, res) => {
  const { id } = req.params;
  const session = await mongoose.startSession();
  try {
    let result;
    try {
      await session.withTransaction(async () => {
        result = await approveCompletionRecord(id, req.user.organization_code, session);
      });
    } catch (error) {
      if (!transactionUnsupported(error)) throw error;
      result = await approveCompletionRecord(id, req.user.organization_code, null);
    }

    const submitterUsername = result.username;
    const submitterGoal = result.goal_code;
    const resultScore = result.scoreDoc;

    logger.info('completion_approved', { completion_id: id });

    // Notify submitter via in-app notification
    if (submitterUsername) {
      Users.findOne({ username: submitterUsername, organization_code: req.user.organization_code })
        .select('email')
        .lean()
        .then((userDoc) => {
          if (userDoc?.email) {
            sendInAppNotification({
              email: userDoc.email,
              title: 'Task Approved',
              description: `Your submitted task for goal "${submitterGoal || 'Goal'}" has been approved! 10 points awarded.`,
            });
          }
        })
        .catch(() => {});
    }

    res.status(200).json({ message: 'Task approved, score updated, and status set to approved', score: resultScore });
  } catch (err) {
    logger.error('completion_approval_failed', { completion_id: id, message: err.message });
    res.status(err.statusCode || 500).json({
      message: err.statusCode ? err.message : 'Approval failed',
      error: err.statusCode ? err.message : 'Approval failed',
    });
  } finally {
    await session.endSession();
  }
};

exports.rejectCompletion = async (req, res) => {
  try {
    const { id } = req.params;

    const completion = await Completion.findOne({
      _id: id,
      organization_code: req.user.organization_code,
    });
    if (!completion) return res.status(404).json({ error: 'Completion not found' });

    // Update only the status, avoiding full validation
    await Completion.updateOne({ _id: id, organization_code: req.user.organization_code }, { status: 'rejected' });

    // Notify submitter via in-app notification
    Users.findOne({ username: completion.username, organization_code: req.user.organization_code })
      .select('email')
      .lean()
      .then((userDoc) => {
        if (userDoc?.email) {
          sendInAppNotification({
            email: userDoc.email,
            title: 'Task Rejected',
            description: `Your submitted task for goal "${completion.goal_code || 'Goal'}" was not approved.`,
          });
        }
      })
      .catch(() => {});

    res.status(200).json({ message: 'Task rejected and status set to rejected' });
  } catch (err) {
    res.status(500).json({ error: 'Rejection failed', details: err.message });
  }
};
// Create a new task completion
exports.createCompletion = async (req, res) => {
  try {
    const { message, goal_code } = req.body;
    if (typeof message !== 'string' || !message.trim() || typeof goal_code !== 'string' || !goal_code.trim()) {
      return res.status(400).json({ error: 'Message and goal code are required' });
    }
    const completion = new Completion({
      username: req.user.username,
      message: message.trim(),
      organization_code: req.user.organization_code,
      goal_code,
    });
    await completion.save();
    res.status(201).json({ message: 'Task completion recorded', completion });
  } catch (err) {
    res.status(500).json({ error: 'Failed to record completion', details: err.message });
  }
};

// Get all task completions with user details
exports.getAllCompletions = async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 200, 500);
    const skip = Math.max(parseInt(req.query.skip) || 0, 0);
    const completions = await Completion.find({ organization_code: req.user.organization_code })
      .skip(skip).limit(limit).lean();
    const usernames = completions.map(c => c.username);
    const users = await Users.find({
      username: { $in: usernames },
      organization_code: req.user.organization_code,
    }).lean();

    const userMap = Object.fromEntries(users.map(user => [user.username, user]));
    const enriched = completions.map(c => ({
      ...c,
      user_details: userMap[c.username] || null
    }));

    res.status(200).json(enriched);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch completions', details: err.message });
  }
};

// Get completions by organization_code
exports.getCompletionsByOrg = async (req, res) => {
  try {
    const orgCode = req.params.organization_code;
    // Defense in depth (E2E audit H-21): the route already guards this
    // with requireOwnOrg, but the controller shouldn't rely solely on the
    // route it happens to be wired to today — a future route change or a
    // direct call from another handler could otherwise expose cross-org data.
    if (req.user.organization_code && orgCode !== req.user.organization_code) {
      return res.status(403).json({ error: 'Not allowed to access another organization\'s completions' });
    }
    const completions = await Completion.find({ organization_code: orgCode }).lean();
    const usernames = completions.map(c => c.username);
    const users = await Users.find({
      username: { $in: usernames },
      organization_code: orgCode,
    }).lean();

    const userMap = Object.fromEntries(users.map(user => [user.username, user]));
    const enriched = completions.map(c => ({
      ...c,
      user_details: userMap[c.username] || null
    }));

    res.status(200).json(enriched);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch completions by org', details: err.message });
  }
};

// Get completions by username
exports.getCompletionsByUser = async (req, res) => {
  try {
    const username = req.params.username;
    if (req.user.role !== 'admin' && username !== req.user.username) {
      return res.status(403).json({ error: 'You can only access your own completions' });
    }
    const tenantFilter = { username, organization_code: req.user.organization_code };
    const completions = await Completion.find(tenantFilter).lean();
    const user = await Users.findOne(tenantFilter).lean();

    const enriched = completions.map(c => ({
      ...c,
      user_details: user || null
    }));

    res.status(200).json(enriched);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch completions by user', details: err.message });
  }
};
