// Child process for quota-database.test.ts; never registered by the application.
import express from 'express';
import { quota } from './quota';
import { closeAllPools } from '../db';

if (process.env.QUOTA_TEST_CHILD !== '1') throw new Error('Test fixture only');
const app = express();
app.use((req, _res, next) => {
  req.publicApi = {
    userId: Number(req.query.user),
    key: { id: String(req.query.key), monthlyUnitLimit: Number(req.query.cap ?? 100) },
    plan: { unitsPerMonth: Number(req.query.plan ?? 100), key: 'pro', requiredPlan: 'pro' },
  } as NonNullable<typeof req.publicApi>;
  next();
});
app.use(quota);
app.get('/', async (req, res) => {
  // Ensure competing processes overlap their allowance check with accepted work.
  await new Promise(resolve => setTimeout(resolve, 75));
  res.status(req.query.fail ? 400 : 200).json({ data: Array(Number(req.query.rows ?? 0)).fill({ ok: true }) });
});
app.use((_error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  res.status(503).json({ error: 'quota unavailable' });
});
const server = app.listen(0, '127.0.0.1', () => {
  const address = server.address();
  if (address && typeof address !== 'string') process.send?.({ port: address.port });
});
process.on('SIGTERM', () => server.close(() => { void closeAllPools().then(() => process.exit(0)); }));
