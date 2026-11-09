// tests/scheduledJobsQueue.integration.test.js
//
// H-02 follow-up: the daily notification/anchor jobs moved from a bare
// node-cron timer to the same real Redis/BullMQ infrastructure already
// used for bulk credential issuance (queues/bulkIssuanceQueue.js). This
// proves, against a real Redis (redis-memory-server actually runs a real
// redis-server binary, not a mock): every schedule in SCHEDULE is really
// registered with the right cron pattern, registering them again (a
// restart, a second replica) never creates a duplicate, and the worker
// really dispatches a triggered job to the correct handler end to end.
//
// The expected count below is derived from SCHEDULE itself (not a
// hardcoded number) specifically because this test went stale twice
// already when a new scheduled job was added (H-22's purge job, then the
// backup job) -- deriving it means adding a fifth job someday can never
// silently break this assertion again.
const test = require('node:test');
const assert = require('node:assert/strict');
const { RedisMemoryServer } = require('redis-memory-server');

let redisServer;

test.before(async () => {
  redisServer = new RedisMemoryServer();
  const host = await redisServer.getHost();
  const port = await redisServer.getPort();
  process.env.REDIS_URL = `redis://${host}:${port}`;
});

test.after(async () => {
  const { getQueue } = require('../queues/scheduledJobsQueue');
  await getQueue()?.close();
  await redisServer.stop();
});

test('registerSchedules creates exactly one job scheduler per entry in SCHEDULE, with the exact configured cron patterns', async () => {
  const { registerSchedules, getQueue, SCHEDULE } = require('../queues/scheduledJobsQueue');
  await registerSchedules();

  const q = getQueue();
  const schedulers = await q.getJobSchedulers();
  assert.equal(schedulers.length, Object.keys(SCHEDULE).length);

  const byId = Object.fromEntries(schedulers.map((s) => [s.key, s]));
  for (const [jobName, pattern] of Object.entries(SCHEDULE)) {
    assert.equal(byId[jobName]?.pattern, pattern, `${jobName} must be registered with its configured pattern`);
  }
});

test('calling registerSchedules again (simulating a restart or a second replica) never creates a duplicate scheduler', async () => {
  const { registerSchedules, getQueue, SCHEDULE } = require('../queues/scheduledJobsQueue');
  await registerSchedules();
  await registerSchedules();
  await registerSchedules();

  const q = getQueue();
  const schedulers = await q.getJobSchedulers();
  assert.equal(schedulers.length, Object.keys(SCHEDULE).length, 'still exactly one scheduler per SCHEDULE entry no matter how many times this is called');
});

test('startScheduledJobsWorker degrades explicitly (returns null, does not throw) when REDIS_URL is not set', () => {
  const savedRedisUrl = process.env.REDIS_URL;
  delete process.env.REDIS_URL;
  delete require.cache[require.resolve('../queues/scheduledJobsWorker')];
  try {
    const { startScheduledJobsWorker } = require('../queues/scheduledJobsWorker');
    const result = startScheduledJobsWorker();
    assert.equal(result, null);
  } finally {
    process.env.REDIS_URL = savedRedisUrl;
    delete require.cache[require.resolve('../queues/scheduledJobsWorker')];
  }
});

test('the worker really dispatches a triggered job to the correct real handler, end to end through Redis', async (t) => {
  // Stub the two downstream functions (they otherwise require a real
  // MONGO_URI-connected Mongo, which is out of scope for what this test
  // is proving -- that BullMQ's job.name really reaches the right
  // handler) by injecting fake modules into the require cache BEFORE the
  // worker file requires them.
  let notifyCalls = 0;
  let anchorCalls = 0;
  const notifyPath = require.resolve('../scripts/notifyExpiringCredentials');
  const anchorPath = require.resolve('../scripts/anchorDailyBatch');
  require.cache[notifyPath] = { id: notifyPath, filename: notifyPath, loaded: true, exports: { run: async () => { notifyCalls += 1; return { stubbed: 'notify' }; } } };
  require.cache[anchorPath] = { id: anchorPath, filename: anchorPath, loaded: true, exports: { run: async () => { anchorCalls += 1; return { stubbed: 'anchor' }; } } };
  delete require.cache[require.resolve('../queues/scheduledJobsWorker')];

  const { startScheduledJobsWorker } = require('../queues/scheduledJobsWorker');
  const { getQueue } = require('../queues/scheduledJobsQueue');
  const worker = startScheduledJobsWorker();
  t.after(async () => {
    await worker.close();
    delete require.cache[notifyPath];
    delete require.cache[anchorPath];
  });

  const q = getQueue();
  const job = await q.add('notify-expiring-credentials', {}, { jobId: `test-immediate-${Date.now()}` });

  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('job did not complete within 10s')), 10_000);
    worker.on('completed', (completedJob) => {
      if (completedJob.id === job.id) {
        clearTimeout(timeout);
        resolve();
      }
    });
    worker.on('failed', (failedJob, err) => {
      if (failedJob?.id === job.id) {
        clearTimeout(timeout);
        reject(err);
      }
    });
  });

  assert.equal(notifyCalls, 1, 'the real handler for "notify-expiring-credentials" must have been invoked exactly once');
  assert.equal(anchorCalls, 0, 'the anchor handler must never fire for a job named notify-expiring-credentials');
});
