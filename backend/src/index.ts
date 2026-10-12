import { DEFAULT_RULES } from './config.ts';
import { createApp } from './http/app.ts';
import { seedDemoUser } from './seed.ts';
import { ProfileService } from './service/profileService.ts';
import { openDatabase } from './store/db.ts';
import { Repository } from './store/repository.ts';

const port = Number(process.env.PORT ?? 8787);
const dbPath = process.env.DB_PATH ?? 'data/sizzlo.db';
const seedDemo = process.env.SEED_DEMO !== 'false';

const repo = new Repository(openDatabase(dbPath));
const service = new ProfileService(repo, DEFAULT_RULES);
if (seedDemo) seedDemoUser(repo, DEFAULT_RULES, new Date());

createApp({ service, corsOrigin: process.env.CORS_ORIGIN ?? '*' }).listen(port, () => {
  console.log(`Sizzlo backend on http://localhost:${port}`);
  if (seedDemo) console.log('Demo user: send "X-User-Id: demo-alex"');
});
