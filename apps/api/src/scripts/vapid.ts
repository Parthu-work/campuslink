/** Prints a fresh VAPID key pair for web push (paste into .env). Usage: pnpm --filter @campuslink/api vapid */
import webpush from 'web-push';

const keys = webpush.generateVAPIDKeys();
console.warn('Add these to your .env (the private key is a secret):\n');
console.warn(`VAPID_PUBLIC_KEY=${keys.publicKey}`);
console.warn(`VAPID_PRIVATE_KEY=${keys.privateKey}`);
