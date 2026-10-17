import { beforeAll, describe, expect, it } from 'vitest';
import mongoose, { Types } from 'mongoose';
import { createCipheriv, randomBytes } from 'node:crypto';
import { loadEnv } from '../src/config/env.js';
import { createApp } from '../src/app.js';
import { createLogger } from '../src/lib/logger.js';
import { MemoryMailProvider } from '../src/lib/mailer.js';
import { MemoryStorage } from '../src/lib/storage.js';
import { InlineJobQueue } from '../src/lib/jobs.js';
import { FieldCipher } from '../src/lib/crypto.js';
import { runInTenant } from '../src/lib/context.js';
import { ENCRYPTED_COLLECTIONS, isComplete, rotateFieldsInTenant } from '../src/scripts/field-rotation.js';
import { UserModel } from '../src/modules/auth/user.model.js';
import { ProfileModel } from '../src/modules/profiles/profile.model.js';
import { WhitelistModel } from '../src/modules/imports/whitelist.model.js';
import { PushSubscriptionModel } from '../src/modules/notifications/notification.model.js';
import { ConversationModel, MessageModel } from '../src/modules/messaging/conversation.model.js';
import { InviteModel } from '../src/modules/verification/verification.model.js';
import { InvitesService } from '../src/modules/verification/invites.service.js';
import type { NotificationsService } from '../src/modules/notifications/notifications.service.js';
import type { AuthState } from '../src/types.js';
import { api, makeTenant, makeUser, type TestTenant, type TestUser } from './helpers.js';

const newKey = () => randomBytes(32).toString('base64');
const KEY_A = newKey();
const KEY_B = newKey();

/** How values were written before rotation existed: `v1.<iv>.<tag>.<ct>`, no key id, no AAD. */
function legacyV1(base64Key: string, plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', Buffer.from(base64Key, 'base64'), iv);
  const ct = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return ['v1', iv, c.getAuthTag(), ct]
    .map((p) => (typeof p === 'string' ? p : p.toString('base64url')))
    .join('.');
}

const appWith = (current: string, previous: string[] = []) => {
  const app = createApp({
    env: loadEnv({
      NODE_ENV: 'test',
      HIBP_ENABLED: 'false',
      FIELD_ENCRYPTION_KEY: current,
      FIELD_ENCRYPTION_KEYS_PREVIOUS: previous.join(','),
    }),
    logger: createLogger('silent'),
    readiness: {},
    mailer: new MemoryMailProvider(),
    storage: new MemoryStorage(),
    jobs: new InlineJobQueue(),
    rateLimitScale: 1000,
  });
  const services = app.locals.services as {
    cipher: FieldCipher;
    notifications: NotificationsService;
  } & Record<string, unknown>;
  return { app, services } as unknown as Parameters<typeof makeUser>[0] & {
    services: { cipher: FieldCipher; notifications: NotificationsService };
  };
};

describe('FieldCipher key ring', () => {
  it('writes v2 values tagged with the key id and reads them back', () => {
    const c = new FieldCipher(KEY_A);
    const v = c.encrypt('+919876543210');
    expect(v.startsWith(`v2.${c.keyId}.`)).toBe(true);
    expect(c.decrypt(v)).toBe('+919876543210');
    expect(c.needsRotation(v)).toBe(false);
    expect(c.encrypt('x')).not.toBe(c.encrypt('x')); // fresh IV
  });

  it('decrypts legacy v1 and previous-key values, and flags them for rotation', () => {
    const a = new FieldCipher(KEY_A);
    const ring = new FieldCipher(KEY_B, [KEY_A]);
    const old = a.encrypt('secret');
    const v1 = legacyV1(KEY_A, 'legacy');
    expect(ring.decrypt(old)).toBe('secret');
    expect(ring.decrypt(v1)).toBe('legacy');
    expect(ring.needsRotation(old)).toBe(true);
    expect(ring.needsRotation(v1)).toBe(true);
    expect(ring.needsRotation(ring.encrypt('new'))).toBe(false);
  });

  it('refuses unknown keys, relabelled values and tampering', () => {
    const a = new FieldCipher(KEY_A);
    const b = new FieldCipher(KEY_B);
    expect(() => b.decrypt(a.encrypt('x'))).toThrow(/Unknown field encryption key id/);
    expect(() => b.decrypt(legacyV1(KEY_A, 'x'))).toThrow(/No configured key/);
    // Relabelling a value with another configured key id fails authentication (the id is AAD).
    const ring = new FieldCipher(KEY_B, [KEY_A]);
    const relabelled = a.encrypt('x').replace(`v2.${a.keyId}.`, `v2.${ring.keyId}.`);
    expect(() => ring.decrypt(relabelled)).toThrow();
    const parts = a.encrypt('hello').split('.');
    parts[4] = Buffer.from('tampered').toString('base64url');
    expect(() => a.decrypt(parts.join('.'))).toThrow();
    expect(() => new FieldCipher(KEY_A, [KEY_A])).toThrow(/different/);
  });

  it('stores the current blind index and matches every configured key', () => {
    const a = new FieldCipher(KEY_A);
    const ring = new FieldCipher(KEY_B, [KEY_A]);
    expect(ring.blindIndexes(' Demo@Example.com ')).toEqual([
      ring.blindIndex('demo@example.com'),
      a.blindIndex('demo@example.com'),
    ]);
    expect(ring.blindIndex('x')).not.toBe(a.blindIndex('x'));
  });

  it('configuration refuses the current key among the previous ones, and malformed keys', () => {
    expect(() => loadEnv({ FIELD_ENCRYPTION_KEY: KEY_A, FIELD_ENCRYPTION_KEYS_PREVIOUS: KEY_A })).toThrow(
      /must not contain/,
    );
    expect(() => loadEnv({ FIELD_ENCRYPTION_KEYS_PREVIOUS: 'c2hvcnQ=' })).toThrow(/32 bytes/);
    expect(
      loadEnv({ FIELD_ENCRYPTION_KEY: KEY_B, FIELD_ENCRYPTION_KEYS_PREVIOUS: ` ${KEY_A} ,` })
        .FIELD_ENCRYPTION_KEYS_PREVIOUS,
    ).toEqual([KEY_A]);
  });
});

describe('rotating a college from key A to key B', () => {
  let T: TestTenant;
  let member: TestUser;
  let other: TestUser;
  const ctxA = appWith(KEY_A);
  const ctxAB = appWith(KEY_B, [KEY_A]);
  const ctxB = appWith(KEY_B);
  const ringAB = new FieldCipher(KEY_B, [KEY_A]);
  const endpoint = 'https://fcm.googleapis.com/fcm/send/rotation-demo';
  const listEmail = 'rotation.demo@rotationtest.example';
  let mfaSecret = '';

  beforeAll(async () => {
    T = await makeTenant('rotationtest');
    member = await makeUser(ctxA, T, { roles: ['ALUMNI'], mfa: true });
    mfaSecret = member.mfaSecret ?? '';
    other = await makeUser(ctxA, T, { roles: ['ALUMNI'] });
    expect(
      (await api(ctxA, T.host, member.token).put('/me/profile').send({ phone: '+919876500001' })).status,
    ).toBe(200);
    const a = ctxA.services.cipher;
    await runInTenant(T._id, async () => {
      await WhitelistModel.create({
        rollNumber: 'ROT-001',
        name: 'Demo Rotation',
        kind: 'alumni',
        source: 'manual',
        emailEnc: a.encrypt(listEmail),
        emailIndex: a.blindIndex(listEmail),
        phoneEnc: legacyV1(KEY_A, '+919876500002'),
        phoneIndex: a.blindIndex('+919876500002'),
      });
      await ctxA.services.notifications.subscribe({ userId: member.id } as AuthState, {
        endpoint,
        keys: { p256dh: 'demo-p256dh', auth: 'demo-auth' },
      });
      const conv = await ConversationModel.create({
        participants: [new Types.ObjectId(member.id), new Types.ObjectId(other.id)],
        pairKey: [member.id, other.id].sort().join('|'),
      });
      await MessageModel.create([
        {
          conversationId: conv._id,
          senderId: new Types.ObjectId(member.id),
          bodyEnc: a.encrypt('Demo message one'),
        },
        {
          conversationId: conv._id,
          senderId: new Types.ObjectId(other.id),
          bodyEnc: legacyV1(KEY_A, 'Demo legacy message'),
        },
        // A value no configured key can decrypt (for example, a key removed too early).
        {
          conversationId: conv._id,
          senderId: new Types.ObjectId(other.id),
          bodyEnc: new FieldCipher(newKey()).encrypt('lost'),
        },
      ]);
      await InviteModel.create({
        emailIndex: a.blindIndex('invitee@rotationtest.example'),
        kind: 'student',
        invitedBy: new Types.ObjectId(),
        expiresAt: new Date(Date.now() + 30 * 86_400_000),
      });
    });
  });

  it('with A as a previous key, everything still works before the migration', async () => {
    const me = await api(ctxAB, T.host, member.token).get('/me/profile');
    expect(me.status).toBe(200);
    expect(me.body.data.profile.fields.phone).toBe('+919876500001');
    await runInTenant(T._id, async () => {
      // Lookups by blind index find records indexed with the old key.
      expect(
        await WhitelistModel.countDocuments({ emailIndex: { $in: ringAB.blindIndexes(listEmail) } }),
      ).toBe(1);
      // Re-subscribing the same browser updates the old record (no duplicate under the unique index).
      await ctxAB.services.notifications.subscribe({ userId: member.id } as AuthState, {
        endpoint,
        keys: { p256dh: 'demo-p256dh', auth: 'demo-auth' },
      });
      expect(await PushSubscriptionModel.countDocuments({})).toBe(1);
      const user = await UserModel.findById(member.id).select('+mfa.secretEnc').lean();
      expect(ringAB.decrypt(String(user?.mfa?.secretEnc))).toBe(mfaSecret);
    });
  });

  it('a dry run reports the work and changes nothing', async () => {
    const before = await runInTenant(T._id, () => MessageModel.find().select('bodyEnc').lean());
    const r = await runInTenant(T._id, () => rotateFieldsInTenant(ringAB, { dryRun: true }));
    const by = Object.fromEntries(r.collections.map((c) => [c.collection, c]));
    expect(by.users).toMatchObject({ reencrypted: 1 });
    expect(by.profiles).toMatchObject({ reencrypted: 1 });
    expect(by.whitelist).toMatchObject({ reencrypted: 2, reindexed: 2 });
    expect(by.messages).toMatchObject({ reencrypted: 2, failed: 1 });
    expect(isComplete(r.collections)).toBe(false);
    const after = await runInTenant(T._id, () => MessageModel.find().select('bodyEnc').lean());
    expect(after).toEqual(before);
  });

  it('re-encrypts and re-indexes everything it can, and a second run has nothing to do', async () => {
    const r = await runInTenant(T._id, () => rotateFieldsInTenant(ringAB));
    expect(r.collections.reduce((n, c) => n + c.skipped, 0)).toBe(0);
    expect(r.openInvitesExpireBy).toBeInstanceOf(Date);
    await runInTenant(T._id, async () => {
      const onB = (v: unknown) => typeof v === 'string' && v.startsWith(`v2.${ringAB.keyId}.`);
      const rec = await WhitelistModel.findOne({ rollNumber: 'ROT-001' }).lean();
      expect(onB(rec?.emailEnc) && onB(rec?.phoneEnc)).toBe(true);
      expect(rec?.emailIndex).toBe(ringAB.blindIndex(listEmail));
      expect(rec?.phoneIndex).toBe(ringAB.blindIndex('+919876500002'));
      const user = await UserModel.findById(member.id).select('+mfa.secretEnc').lean();
      expect(onB(user?.mfa?.secretEnc)).toBe(true);
      expect(onB((await ProfileModel.findOne({ userId: member.id }).lean())?.phoneEnc)).toBe(true);
      const push = await PushSubscriptionModel.findOne().lean();
      expect(onB(push?.endpointEnc) && onB(push?.keysEnc)).toBe(true);
      expect(push?.endpointIndex).toBe(ringAB.blindIndex(endpoint));
      const bodies = (await MessageModel.find().sort({ _id: 1 }).lean()).map((m) => String(m.bodyEnc));
      expect(bodies.filter(onB)).toHaveLength(2);
    });
    const again = await runInTenant(T._id, () => rotateFieldsInTenant(ringAB));
    // Only the undecryptable value remains; it is reported, never overwritten.
    expect(again.collections.every((c) => c.reencrypted === 0 && c.reindexed === 0)).toBe(true);
    expect(again.collections.find((c) => c.collection === 'messages')?.failed).toBe(1);
  });

  it('after removing key A, the college works on key B alone', async () => {
    const me = await api(ctxB, T.host, member.token).get('/me/profile');
    expect(me.body.data.profile.fields.phone).toBe('+919876500001');
    const b = ctxB.services.cipher;
    await runInTenant(T._id, async () => {
      expect(await WhitelistModel.countDocuments({ emailIndex: { $in: b.blindIndexes(listEmail) } })).toBe(1);
      const user = await UserModel.findById(member.id).select('+mfa.secretEnc').lean();
      expect(b.decrypt(String(user?.mfa?.secretEnc))).toBe(mfaSecret);
      const texts = (await MessageModel.find({ senderId: member.id }).lean()).map((m) =>
        b.decrypt(String(m.bodyEnc)),
      );
      expect(texts).toEqual(['Demo message one']);
    });
  });

  it('invites keep an old-key index, so the previous key stays until they expire', async () => {
    const stub = {} as never;
    await runInTenant(T._id, async () => {
      // Without key A the invite is not found…
      expect(
        await new InvitesService(ctxB.services.cipher, stub, stub).consume('invitee@rotationtest.example'),
      ).toBeNull();
      // …with A still configured as previous it is.
      expect(await new InvitesService(ringAB, stub, stub).consume('invitee@rotationtest.example')).toEqual({
        kind: 'student',
      });
    });
  });
});

describe('the rotation covers every encrypted field', () => {
  it('lists every schema path ending in Enc', () => {
    const covered = new Set(
      ENCRYPTED_COLLECTIONS.flatMap((c) => c.fields.map((f) => `${c.model.modelName}.${f}`)),
    );
    const found = mongoose.modelNames().flatMap((name) =>
      Object.keys(mongoose.model(name).schema.paths)
        .filter((p) => /Enc$/.test(p))
        .map((p) => `${name}.${p}`),
    );
    expect(found.length).toBeGreaterThan(0);
    expect(found.filter((f) => !covered.has(f))).toEqual([]);
  });
});
