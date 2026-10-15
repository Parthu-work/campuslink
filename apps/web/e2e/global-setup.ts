import { execSync } from 'node:child_process';
import { rmSync } from 'node:fs';

/** Fresh, deterministic demo data for every run (fictional colleges and people only). */
export default async function globalSetup() {
  rmSync('test-results/.admin-totp.json', { force: true });
  // Fresh mailbox so codes from earlier runs are never read.
  await fetch('http://127.0.0.1:8025/api/v1/messages', { method: 'DELETE' }).catch(() => undefined);
  const mongo = process.env.MONGODB_URI ?? 'mongodb://127.0.0.1:27017/campuslink_e2e?directConnection=true';
  execSync('pnpm --filter @campuslink/api seed', {
    stdio: 'inherit',
    env: { ...process.env, NODE_ENV: 'test', MONGODB_URI: mongo },
  });
}
