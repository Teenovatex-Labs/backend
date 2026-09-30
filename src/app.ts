import './config.js';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { config } from './config.js';
import { prisma } from './db.js';
import { globalLimiter } from './middleware/rateLimiter.js';
import { errorHandler, notFound } from './middleware/errorHandler.js';
import authRouter from './routes/auth.js';
import usersRouter from './routes/users.js';
import projectsRouter from './routes/projects.js';
import votesRouter from './routes/votes.js';
import eventsRouter from './routes/events.js';
import learnRouter from './routes/learn.js';
import { blocksRouter, reportsRouter } from './routes/safety.js';
import adminRouter from './routes/admin.js';
import communityRouter from './routes/community.js';
import messagesRouter from './routes/messages.js';
import labsDeepRouter from './routes/labsDeep.js';
import petRouter from './routes/pet.js';
import announcementsRouter from './routes/announcements.js';
import rewardsRouter from './routes/rewards.js';
import searchRouter from './routes/search.js';
import realtimeRouter from './routes/realtime.js';
import { startReminders } from './jobs/reminders.js';
import pointsRouter from './routes/points.js';
import leaderboardRouter from './routes/leaderboard.js';
import notificationsRouter from './routes/notifications.js';
import settingsRouter from './routes/settings.js';
import contactRouter from './routes/contact.js';

const app = express();

app.disable('x-powered-by');

// Behind nginx every request arrives from 127.0.0.1; trusting one proxy hop makes
// req.ip (and so every rate limiter) key on the real visitor instead.
app.set('trust proxy', 1);

app.use(helmet());

// Only the origins listed in FRONTEND_URL may call the API from a browser. There is
// deliberately no wildcard fallback: a missing list fails at startup in production.
app.use(
  cors({
    origin: config.allowedOrigins,
    credentials: true,
  })
);

// The largest legitimate JSON body is a project description; images go through multer.
app.use(express.json({ limit: '100kb' }));
app.use(globalLimiter);

const v1 = '/api/v1';
app.use(`${v1}/auth`, authRouter);
app.use(`${v1}/users`, usersRouter);
app.use(`${v1}/projects`, projectsRouter);
app.use(`${v1}/projects`, labsDeepRouter);
app.use(`${v1}/votes`, votesRouter);
app.use(`${v1}/events`, eventsRouter);
app.use(`${v1}/learn`, learnRouter);
app.use(`${v1}/reports`, reportsRouter);
app.use(`${v1}/blocks`, blocksRouter);
app.use(`${v1}/admin`, adminRouter);
app.use(`${v1}/community`, communityRouter);
app.use(`${v1}/messages`, messagesRouter);
app.use(`${v1}/pet`, petRouter);
app.use(`${v1}/announcements`, announcementsRouter);
app.use(`${v1}/rewards`, rewardsRouter);
app.use(`${v1}/search`, searchRouter);
app.use(`${v1}/realtime`, realtimeRouter);
app.use(`${v1}/points`, pointsRouter);
app.use(`${v1}/leaderboard`, leaderboardRouter);
app.use(`${v1}/notifications`, notificationsRouter);
app.use(`${v1}/settings`, settingsRouter);
app.use(`${v1}/contact`, contactRouter);

app.get('/', (_req, res) => res.json({ status: 'TX API v1 running' }));

// Liveness answers instantly (is the process up?); readiness also proves the database
// is reachable. Point uptime monitoring at /health/ready.
app.get('/health', (_req, res) => res.json({ status: 'ok' }));
app.get('/health/ready', async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: 'ready' });
  } catch {
    res.status(503).json({ status: 'unavailable', code: 'DB_UNAVAILABLE' });
  }
});

app.use(notFound);
app.use(errorHandler);

if (config.env !== 'test') {
  app.listen(config.port, () => console.log(`Server running on port http://localhost:${config.port}`));
  startReminders();
}

export { app };
