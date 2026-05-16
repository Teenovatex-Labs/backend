import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { globalLimiter } from './middleware/rateLimiter.js';
import authRouter from './routes/auth.js';
import usersRouter from './routes/users.js';
import projectsRouter from './routes/projects.js';
import votesRouter from './routes/votes.js';
import pointsRouter from './routes/points.js';
import leaderboardRouter from './routes/leaderboard.js';
import notificationsRouter from './routes/notifications.js';
import settingsRouter from './routes/settings.js';
import adminRouter from './routes/admin.js';
import { errorHandler, notFoundHandler } from './middleware/error.js';

dotenv.config();

const requiredEnv = [
  'DATABASE_URL',
  'JWT_SECRET',
  'JWT_REFRESH_SECRET',
  'CLOUDINARY_CLOUD_NAME',
  'CLOUDINARY_API_KEY',
  'CLOUDINARY_API_SECRET',
];

for (const env of requiredEnv) {
  if (!process.env[env]) {
    console.error(`[CRITICAL] Missing required environment variable: ${env}`);
    process.exit(1);
  }
}

const app = express();

app.use(cors({ origin: process.env.FRONTEND_URL ?? '*', credentials: true }));
app.use(express.json());
app.use(globalLimiter);

const v1 = '/api/v1';
app.use(`${v1}/auth`, authRouter);
app.use(`${v1}/users`, usersRouter);
app.use(`${v1}/projects`, projectsRouter);
app.use(`${v1}/votes`, votesRouter);
app.use(`${v1}/points`, pointsRouter);
app.use(`${v1}/leaderboard`, leaderboardRouter);
app.use(`${v1}/notifications`, notificationsRouter);
app.use(`${v1}/settings`, settingsRouter);
app.use(`${v1}/admin`, adminRouter);

app.get('/', (_req, res) => res.json({ status: 'TX API v1 running' }));

// 404 Fallback Handler
app.use(notFoundHandler);

// Global Error Handler
app.use(errorHandler);

const PORT = process.env.PORT ?? 3000;
app.listen(PORT, () => console.log(`Server running on port http://localhost:${PORT}`));

export { app };
