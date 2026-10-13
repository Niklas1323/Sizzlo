import { join } from 'node:path';
import { DEFAULT_RULES } from './config.ts';
import { createApp } from './http/app.ts';
import { seedDemoUser } from './seed.ts';
import { webhookSink } from './service/feedback.ts';
import { ProfileService } from './service/profileService.ts';
import { openDatabase } from './store/db.ts';
import { MediaStore } from './store/media.ts';
import { Repository } from './store/repository.ts';

const port = Number(process.env.PORT ?? 8787);
const dataDir = process.env.DATA_DIR ?? 'data';
const seedDemo = process.env.SEED_DEMO !== 'false';
const feedbackWebhook = process.env.FEEDBACK_WEBHOOK_URL;

const repo = new Repository(openDatabase(join(dataDir, 'sizzlo.db')));
const service = new ProfileService(repo, new MediaStore(join(dataDir, 'media')), DEFAULT_RULES, undefined, feedbackWebhook ? webhookSink(feedbackWebhook) : null);
if (seedDemo) seedDemoUser(repo, DEFAULT_RULES, new Date());

createApp({
  service,
  maxPhotoBytes: DEFAULT_RULES.maxPhotoBytes,
  corsOrigin: process.env.CORS_ORIGIN ?? '*',
  adminKey: process.env.ADMIN_KEY || undefined,
  feedbackMaxChars: DEFAULT_RULES.feedbackMaxChars,
}).listen(port, () => {
  console.log(`Sizzlo backend on http://localhost:${port}`);
  if (!feedbackWebhook) console.log('Feedback is stored only: set FEEDBACK_WEBHOOK_URL to have it sent to the team.');
  if (seedDemo) console.log('Demo user: send "X-User-Id: demo-alex"');
});
