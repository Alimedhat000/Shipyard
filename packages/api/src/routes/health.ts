import { Router } from 'express';
import { healthCheck } from '../plugins/db.js';
import { redisHealthCheck } from '../plugins/redis.js';
import { getEnv } from '../config/env.js';

export function createHealthRouter(): Router {
  const router = Router();

  router.get('/', async (req, res) => {
    const env = getEnv();
    const dbStatus = await healthCheck().then(() => 'connected').catch(() => 'disconnected');
    const redisStatus = await redisHealthCheck().then(() => 'connected').catch(() => 'disconnected');

    res.json({
      status: dbStatus === 'connected' && redisStatus === 'connected' ? 'healthy' : 'unhealthy',
      timestamp: new Date().toISOString(),
      environment: env.NODE_ENV,
      services: {
        database: dbStatus,
        redis: redisStatus,
      },
    });
  });

  return router;
}
