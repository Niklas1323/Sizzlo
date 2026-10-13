import type { FeedbackEntry } from '../store/repository.ts';
import type { FeedbackSink } from './profileService.ts';

/**
 * The JSON posted to the team's webhook. `text` (Slack) and `content` (Discord) are the
 * fields chat webhooks show as the message; `feedback` carries every field for anything else.
 */
export function webhookPayload(entry: FeedbackEntry) {
  const where = [entry.screen, entry.appVersion && `v${entry.appVersion}`, entry.language].filter(Boolean).join(' · ');
  const line = `Sizzlo feedback from ${entry.displayName} (${where}):\n${entry.message}`;
  return { text: line, content: line.slice(0, 2000), feedback: entry };
}

/** Posts every feedback message to `url`. Gives up after `timeoutMs`; the message stays stored either way. */
export function webhookSink(url: string, timeoutMs = 5000): FeedbackSink {
  return async (entry) => {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(webhookPayload(entry)),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) throw new Error(`webhook answered ${res.status}`);
  };
}
