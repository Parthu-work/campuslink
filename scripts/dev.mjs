// One command to start everything: infrastructure (Docker) + API + web, with readable failures.
import { spawnSync, spawn } from 'node:child_process';
import { existsSync, copyFileSync } from 'node:fs';

if (!existsSync('.env')) {
  copyFileSync('.env.example', '.env');
  console.log('Created .env from .env.example (local defaults only; never use these secrets in production).');
}

const infra = spawnSync('docker', ['compose', 'up', '-d', '--wait'], { stdio: 'inherit' });
if (infra.status !== 0) {
  console.error('\nDocker infrastructure failed to start. Is Docker running? Try: docker compose logs');
  process.exit(infra.status ?? 1);
}

console.log('\nMongoDB :27017 · Redis :6379 · Mailpit UI http://localhost:8025');
console.log('API http://localhost:4000/api/v1/health · Web http://localhost:5173\n');

const apps = spawn('pnpm', ['run', 'dev:apps'], { stdio: 'inherit' });
apps.on('exit', (code) => process.exit(code ?? 0));
