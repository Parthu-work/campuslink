import { randomBytes } from 'node:crypto';
import { SignJWT } from 'jose';
import { AppError } from './errors.js';
import { ErrorCode } from '@campuslink/shared';

export interface JoinInput {
  room: string;
  user: { id: string; name: string };
  moderator: boolean;
  notBefore: Date;
  expiresAt: Date;
}

/** Swappable video adapter (Jitsi locally; 100ms and Daily are stubs until a deployment configures them). */
export interface VideoProvider {
  readonly name: 'jitsi' | '100ms' | 'daily';
  /** A new non-guessable room name (160 random bits). */
  newRoom(): string;
  joinUrl(input: JoinInput): Promise<string>;
}

const BASE32 = 'abcdefghijklmnopqrstuvwxyz234567';
export function randomRoomName(): string {
  const bytes = randomBytes(20);
  let bits = 0;
  let value = 0;
  let out = '';
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  return `mentor-${out}`;
}

/**
 * Jitsi Meet. With JITSI_APP_ID/SECRET (self-hosted Jitsi with token auth) the link carries a JWT
 * that is valid only for the join window, so a leaked link stops working. On the public meet.jit.si
 * the API simply refuses to hand out the link outside the window.
 */
export class JitsiVideoProvider implements VideoProvider {
  readonly name = 'jitsi' as const;
  private readonly base: URL;
  constructor(
    baseUrl: string,
    private readonly auth?: { appId: string; secret: string },
  ) {
    this.base = new URL(baseUrl);
  }
  newRoom() {
    return randomRoomName();
  }
  async joinUrl(input: JoinInput): Promise<string> {
    const url = new URL(`/${input.room}`, this.base);
    if (this.auth) {
      const jwt = await new SignJWT({
        room: input.room,
        context: { user: { id: input.user.id, name: input.user.name, moderator: input.moderator } },
      })
        .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
        .setIssuer(this.auth.appId)
        .setAudience('jitsi')
        .setSubject(this.base.hostname)
        .setNotBefore(Math.floor(input.notBefore.getTime() / 1000))
        .setExpirationTime(Math.floor(input.expiresAt.getTime() / 1000))
        .sign(new TextEncoder().encode(this.auth.secret));
      url.searchParams.set('jwt', jwt);
    }
    // Display name only; Jitsi reads config from the fragment, which is never sent to a server.
    url.hash = `userInfo.displayName=${encodeURIComponent(JSON.stringify(input.user.name))}&config.prejoinPageEnabled=true`;
    return url.toString();
  }
}

class UnconfiguredVideoProvider implements VideoProvider {
  constructor(readonly name: '100ms' | 'daily') {}
  newRoom() {
    return randomRoomName();
  }
  async joinUrl(): Promise<string> {
    throw new AppError(
      503,
      ErrorCode.INTERNAL,
      `Video calls are not set up yet (${this.name} adapter is a stub). Ask your college administrator.`,
    );
  }
}
/** Stubs: implement against the provider's room and token APIs when a deployment chooses them. */
export const hmsVideoStub = () => new UnconfiguredVideoProvider('100ms');
export const dailyVideoStub = () => new UnconfiguredVideoProvider('daily');
