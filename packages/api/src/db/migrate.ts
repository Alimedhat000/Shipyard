import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import * as schema from '@shipyard/shared';

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL is required');
  }

  console.log('running database migrations...');
  const client = postgres(url, { max: 1 });
  const db = drizzle(client, { schema });

  await migrate(db, { migrationsFolder: new URL('../../../drizzle', import.meta.url).pathname });
  await client.end();
  console.log('migrations complete');
}

main().catch((err) => {
  console.error('migration failed:', err);
  process.exit(1);
});
