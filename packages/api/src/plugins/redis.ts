import Redis from 'ioredis';
import { getEnv } from '../config/env.js';

const env = getEnv();

export const redis = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: 3,
  lazyConnect: true,
});

export async function redisHealthCheck() {
  await redis.connect();
  await redis.ping();
  return { redis: 'connected' };
}