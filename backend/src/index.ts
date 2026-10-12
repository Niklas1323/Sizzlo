import { join } from 'node:path';
import { DEFAULT_RULES } from './config.ts';
import { createApp } from './http/app.ts';
import { seedDemoUser } from './seed.ts';
import { ProfileService } from './service/profileService.ts';
import { openDatabase } from './store/db.ts';
import { MediaStore } from './store/media.ts';
import { Repository } from './store/repository.ts';

const port = Number(process.env.PORT ?? 8787);
const dataDir = process.env.DATA_DIR ?? 'data';
const seedDemo = process.env.SEED_DEMO !== 'false';

const repo = new Repository(openDatabase(join(dataDir, 'sizzlo.db')));
const service = new ProfileService(repo, new MediaStore(join(dataDir, 'media')), DEFAULT_RULES);
if (seedDemo) seedDemoUser(repo, DEFAULT_RULES, new Date());

createApp({ service, maxPhotoBytes: DEFAULT_RULES.maxPhotoBytes, corsOrigin: process.env.CORS_ORIGIN ?? '*' }).listen(port, () => {
  console.log(`Sizzlo backend on http://localhost:${port}`);
  if (seedDemo) console.log('Demo user: send "X-User-Id: demo-alex"');
});
