require('dotenv').config();

const express = require('express');
const http = require('http');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const helmet = require('helmet');
const mongoSanitize = require('express-mongo-sanitize');
const mongoose = require('mongoose');
const { rateLimit, ipKeyGenerator } = require('express-rate-limit');

const connectDB = require('./config/db');
const authMiddleware = require('./middleware/authMiddleware');
const { MongoRateLimitStore } = require('./utils/mongoRateLimitStore');
const initWebSocket = require('./websocket/chatSocket');
const { handleChat } = require('./controllers/chatbotController');
const User = require('./models/User');
const Ticket = require('./models/tickets');
const Article = require('./models/articleSchema');
const FAQ = require('./models/faqSchema');

const authRoutes = require('./routes/authRoutes');
const organizationRoutes = require('./routes/organizationController');
const ticketRoutes = require('./routes/ticketRoutes');
const articleRoutes = require('./routes/articleRoutes');
const faqRoutes = require('./routes/faqRoutes');
const otpRoutes = require('./routes/otpRoutes');
const chatRoutes = require('./routes/chatRoutes');

const app = express();
const server = http.createServer(app);
let websocketServer = null;

if (process.env.NODE_ENV === 'production') {
  for (const name of ['MONGO_URI', 'JWT_SECRET', 'DEFAULT_ORG_CODE', 'PUBLIC_STORAGE_BASE_URL']) {
    if (!process.env[name]) throw new Error(`${name} is required in production`);
  }
  if (process.env.JWT_SECRET.length < 32) throw new Error('JWT_SECRET must contain at least 32 characters in production');
  if (new URL(process.env.PUBLIC_STORAGE_BASE_URL).protocol !== 'https:') {
    throw new Error('PUBLIC_STORAGE_BASE_URL must use HTTPS in production');
  }
}

const trustProxyHops = Number.parseInt(process.env.TRUST_PROXY_HOPS || '0', 10);
app.set('trust proxy', Number.isFinite(trustProxyHops) ? trustProxyHops : 0);
app.use(helmet());

const allowedOrigins = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map(origin => origin.trim())
  .filter(Boolean);
if (process.env.NODE_ENV === 'production' && allowedOrigins.length === 0) {
  throw new Error('ALLOWED_ORIGINS is required in production');
}
app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.length === 0 || allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    return callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
}));

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));
app.use(cookieParser());

// See backend (updated)/api.js for the full explanation -- scoped to
// req.body only, since Express 5 makes req.query/req.params getter-only
// and express-mongo-sanitize's normal auto-middleware crashes every
// request trying to reassign them (verified: 500 on every route).
app.use((req, res, next) => {
  if (req.body && typeof req.body === 'object') {
    req.body = mongoSanitize.sanitize(req.body);
  }
  next();
});

const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  passOnStoreError: process.env.NODE_ENV !== 'production',
  store: new MongoRateLimitStore('global'),
  message: { error: 'Too many requests from this IP, please try again later.' },
});
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  keyGenerator: req => `${ipKeyGenerator(req.ip)}:${String(req.body?.emailOrUsername || '').trim().toLowerCase()}`,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  passOnStoreError: process.env.NODE_ENV !== 'production',
  store: new MongoRateLimitStore('auth'),
  message: { error: 'Too many authentication attempts. Please try again later.' },
});

app.use('/api', globalLimiter);
app.use('/api', (req, res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const origin = req.get('origin');
  if (origin && !allowedOrigins.includes(origin)) {
    return res.status(403).json({ message: 'Request origin is not allowed' });
  }
  return next();
});

app.use('/api/auth/login', authLimiter);
app.use('/api/auth/register', authLimiter);
app.use('/api/otp', authLimiter);
app.use('/api/auth', authRoutes);
app.use('/api/organizations', organizationRoutes);
app.use('/api/tickets', ticketRoutes);
app.use('/api/otp', otpRoutes);
app.use('/api/articles', articleRoutes);
app.use('/api/faqs', faqRoutes);
app.use('/api/chat', chatRoutes);

app.post('/api/chat', async (req, res, next) => {
  try {
    const { message, sessionId } = req.body;
    if (typeof message !== 'string' || !message.trim()) {
      return res.status(400).json({ error: 'Message is required' });
    }
    const response = await handleChat(message.trim(), sessionId || 'rest-api');
    return res.json({ response, timestamp: new Date().toISOString() });
  } catch (error) {
    return next(error);
  }
});

app.get('/health', (req, res) => {
  const connected = mongoose.connection.readyState === 1;
  return res.status(connected ? 200 : 503).json({
    status: connected ? 'healthy' : 'degraded',
    database: connected ? 'connected' : 'disconnected',
    websocket_sessions: websocketServer ? websocketServer.getActiveSessionsCount() : 0,
    timestamp: new Date().toISOString(),
  });
});

app.get('/api/system/status', authMiddleware(['admin', 'agent']), (req, res) => {
  const connected = mongoose.connection.readyState === 1;
  return res.status(connected ? 200 : 503).json({
    success: connected,
    status: connected ? 'operational' : 'degraded',
    services: {
      database: connected ? 'connected' : 'disconnected',
      websocket: websocketServer ? 'running' : 'stopped',
    },
    uptime_seconds: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
  });
});

app.get('/api/system/agents/status', authMiddleware(['admin', 'agent']), async (req, res, next) => {
  try {
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
    const agents = await User.find({
      org_code: req.user.org_code,
      user_type: 'agent',
    }).select('name username last_seen is_active').lean();
    const active = agents.filter(agent => agent.is_active && agent.last_seen >= fiveMinutesAgo).length;
    return res.json({
      success: true,
      agentAvailability: {
        total: agents.length,
        active,
        inactive: agents.length - active,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    return next(error);
  }
});

app.get('/api/system/dashboard', authMiddleware(['admin', 'agent']), async (req, res, next) => {
  try {
    const organizationCode = req.user.org_code;
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const [statusRows, priorityRows, dailyRows, totalAgents, activeAgents, articleCount, faqCount] = await Promise.all([
      Ticket.aggregate([
        { $match: { organization_code: organizationCode } },
        { $group: { _id: '$status', count: { $sum: 1 } } },
      ]),
      Ticket.aggregate([
        { $match: { organization_code: organizationCode } },
        { $group: { _id: '$priority', count: { $sum: 1 } } },
      ]),
      Ticket.aggregate([
        { $match: { organization_code: organizationCode, createdAt: { $gte: sevenDaysAgo } } },
        {
          $group: {
            _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: 'UTC' } },
            created: { $sum: 1 },
            resolved: {
              $sum: { $cond: [{ $in: ['$status', ['resolved', 'closed']] }, 1, 0] },
            },
          },
        },
        { $sort: { _id: 1 } },
      ]),
      User.countDocuments({ org_code: organizationCode, user_type: 'agent' }),
      User.countDocuments({
        org_code: organizationCode,
        user_type: 'agent',
        is_active: true,
        last_seen: { $gte: new Date(Date.now() - 5 * 60 * 1000) },
      }),
      Article.countDocuments({ organization_code: organizationCode }),
      FAQ.countDocuments({ organization_code: organizationCode }),
    ]);

    const statuses = Object.fromEntries(statusRows.map(row => [row._id, row.count]));
    const priorities = Object.fromEntries(priorityRows.map(row => [row._id, row.count]));
    const totalTickets = Object.values(statuses).reduce((total, count) => total + count, 0);
    const resolvedTickets = (statuses.resolved || 0) + (statuses.closed || 0);

    return res.json({
      success: true,
      data: {
        total_tickets: totalTickets,
        open_tickets: (statuses.open || 0) + (statuses.pending || 0) + (statuses.in_progress || 0),
        resolved_tickets: resolvedTickets,
        resolution_rate: totalTickets ? Math.round((resolvedTickets / totalTickets) * 100) : 0,
        statuses,
        priorities,
        agents: { total: totalAgents, active: activeAgents },
        knowledge_base: { articles: articleCount, faqs: faqCount },
        seven_day_activity: dailyRows.map(row => ({ date: row._id, created: row.created, resolved: row.resolved })),
        generated_at: new Date().toISOString(),
      },
    });
  } catch (error) {
    return next(error);
  }
});

app.use((req, res) => res.status(404).json({ error: 'Endpoint not found' }));
app.use((error, req, res, next) => {
  console.error(JSON.stringify({
    level: 'error',
    event: 'unhandled_request_error',
    method: req.method,
    path: req.originalUrl,
    message: error.message,
  }));
  return res.status(error.status || 500).json({
    error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error',
  });
});

async function shutdown(signal) {
  console.log(JSON.stringify({ level: 'info', event: 'shutdown_started', signal }));
  if (websocketServer) websocketServer.close();
  await new Promise(resolve => server.close(resolve));
  await mongoose.connection.close();
}

async function startServer() {
  await connectDB();
  websocketServer = initWebSocket(server);
  app.set('wsServer', websocketServer);
  const port = Number.parseInt(process.env.PORT || '8000', 10);
  await new Promise(resolve => server.listen(port, resolve));
  console.log(JSON.stringify({ level: 'info', event: 'server_started', port }));
  return server;
}

if (require.main === module) {
  startServer().catch(error => {
    console.error(JSON.stringify({ level: 'fatal', event: 'startup_failed', message: error.message }));
    process.exit(1);
  });
  for (const signal of ['SIGTERM', 'SIGINT']) {
    process.once(signal, () => {
      shutdown(signal).then(() => process.exit(0)).catch(() => process.exit(1));
    });
  }
}

module.exports = { app, server, startServer };
