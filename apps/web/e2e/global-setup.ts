import { execSync } from 'node:child_process';

/** Fresh, deterministic demo data for every run (fictional colleges and people only). */
export default function globalSetup() {
  const mongo = process.env.MONGODB_URI ?? 'mongodb://127.0.0.1:27017/campuslink_e2e?directConnection=true';
  execSync('pnpm --filter @campuslink/api seed', {
    stdio: 'inherit',
    env: { ...process.env, NODE_ENV: 'test', MONGODB_URI: mongo },
  });
}
