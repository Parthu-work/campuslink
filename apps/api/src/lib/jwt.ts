import { SignJWT, jwtVerify, errors } from 'jose';

export interface AccessClaims {
  sub: string;
  tid: string;
  sid: string;
  ver: number;
}
export interface MfaTicketClaims {
  sub: string;
  tid: string;
}

const ISSUER = 'campuslink';
const ALG = 'HS256';

export class TokenService {
  private readonly accessKey: Uint8Array;
  private readonly ticketKey: Uint8Array;
  constructor(
    accessSecret: string,
    ticketSecret: string,
    readonly accessTtl: number,
  ) {
    this.accessKey = new TextEncoder().encode(accessSecret);
    this.ticketKey = new TextEncoder().encode(ticketSecret);
  }

  signAccess(c: AccessClaims): Promise<string> {
    return new SignJWT({ tid: c.tid, sid: c.sid, ver: c.ver })
      .setProtectedHeader({ alg: ALG, typ: 'JWT' })
      .setSubject(c.sub)
      .setIssuer(ISSUER)
      .setAudience('access')
      .setIssuedAt()
      .setExpirationTime(`${this.accessTtl}s`)
      .sign(this.accessKey);
  }

  async verifyAccess(token: string): Promise<AccessClaims | null> {
    try {
      const { payload } = await jwtVerify(token, this.accessKey, {
        issuer: ISSUER,
        audience: 'access',
        algorithms: [ALG],
      });
      if (
        typeof payload.sub !== 'string' ||
        typeof payload.tid !== 'string' ||
        typeof payload.sid !== 'string' ||
        typeof payload.ver !== 'number'
      )
        return null;
      return { sub: payload.sub, tid: payload.tid, sid: payload.sid, ver: payload.ver };
    } catch (e) {
      if (e instanceof errors.JOSEError) return null;
      throw e;
    }
  }

  /** Short-lived ticket proving the password step passed, redeemable only with a TOTP code. */
  signMfaTicket(c: MfaTicketClaims): Promise<string> {
    return new SignJWT({ tid: c.tid })
      .setProtectedHeader({ alg: ALG })
      .setSubject(c.sub)
      .setIssuer(ISSUER)
      .setAudience('mfa')
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(this.ticketKey);
  }

  async verifyMfaTicket(token: string): Promise<MfaTicketClaims | null> {
    try {
      const { payload } = await jwtVerify(token, this.ticketKey, {
        issuer: ISSUER,
        audience: 'mfa',
        algorithms: [ALG],
      });
      if (typeof payload.sub !== 'string' || typeof payload.tid !== 'string') return null;
      return { sub: payload.sub, tid: payload.tid };
    } catch {
      return null;
    }
  }
}
