import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';
import type { SsoError, SsoProvider } from '@campuslink/shared';

/**
 * OpenID Connect with the college's own identity provider (prompt 2, G9): Google Workspace or
 * Microsoft Entra ID, authorization code with PKCE. Endpoints are fixed per provider (no discovery
 * fetch), and every ID token is checked for issuer, audience, nonce and expiry before anything else.
 */
export interface ProviderEndpoints {
  authorize: string;
  token: string;
  jwks: string;
  issuer: string | string[];
}

export function endpointsOf(provider: SsoProvider, directoryId: string | null): ProviderEndpoints {
  if (provider === 'google')
    return {
      authorize: 'https://accounts.google.com/o/oauth2/v2/auth',
      token: 'https://oauth2.googleapis.com/token',
      jwks: 'https://www.googleapis.com/oauth2/v3/certs',
      issuer: ['https://accounts.google.com', 'accounts.google.com'],
    };
  if (!directoryId) throw new OidcError('unavailable', 'The Microsoft directory is not set');
  // The college's own directory, never "common": only its accounts can sign in.
  const base = `https://login.microsoftonline.com/${directoryId}`;
  return {
    authorize: `${base}/oauth2/v2.0/authorize`,
    token: `${base}/oauth2/v2.0/token`,
    jwks: `${base}/discovery/v2.0/keys`,
    issuer: `${base}/v2.0`,
  };
}

export class OidcError extends Error {
  constructor(
    readonly reason: SsoError,
    message: string,
  ) {
    super(message);
  }
}

const jwksCache = new Map<string, JWTVerifyGetKey>();
/** The provider's signing keys (fetched by jose, cached and refreshed on an unknown key id). */
export const remoteKeys = (url: string): JWTVerifyGetKey => {
  let k = jwksCache.get(url);
  if (!k) {
    k = createRemoteJWKSet(new URL(url), { timeoutDuration: 5000, cooldownDuration: 30_000 });
    jwksCache.set(url, k);
  }
  return k;
};

export interface VerifiedIdentity {
  subject: string;
  email: string;
  name: string;
}

const EMAIL = /^[^@\s]+@([a-z0-9.-]+\.[a-z]{2,})$/i;

/** Verifies an ID token and returns who it is about, or throws OidcError with the reason. */
export async function verifyIdToken(
  idToken: string,
  o: {
    provider: SsoProvider;
    clientId: string;
    directoryId: string | null;
    nonce: string;
    allowedDomains: string[];
    keys: JWTVerifyGetKey;
    now?: Date;
  },
): Promise<VerifiedIdentity> {
  const ep = endpointsOf(o.provider, o.directoryId);
  let payload: Record<string, unknown>;
  try {
    ({ payload } = await jwtVerify(idToken, o.keys, {
      issuer: ep.issuer,
      audience: o.clientId,
      algorithms: ['RS256'],
      clockTolerance: 60,
      maxTokenAge: '1h',
      ...(o.now ? { currentDate: o.now } : {}),
    }));
  } catch {
    throw new OidcError('failed', 'The sign-in could not be verified');
  }
  if (typeof payload.nonce !== 'string' || payload.nonce !== o.nonce)
    throw new OidcError('failed', 'The sign-in could not be verified');
  const sub = typeof payload.sub === 'string' ? payload.sub : '';
  if (!sub) throw new OidcError('failed', 'The sign-in could not be verified');
  const allowed = o.allowedDomains.map((d) => d.toLowerCase());
  let email: string;
  if (o.provider === 'google') {
    email = typeof payload.email === 'string' ? payload.email.toLowerCase() : '';
    // A Workspace account of one of the college's domains, with a confirmed address.
    const hd = typeof payload.hd === 'string' ? payload.hd.toLowerCase() : '';
    if (payload.email_verified !== true) throw new OidcError('failed', 'The address is not confirmed');
    if (!hd || !allowed.includes(hd) || EMAIL.exec(email)?.[1]?.toLowerCase() !== hd)
      throw new OidcError('domain', 'That account is not one of the college’s');
  } else {
    if (payload.tid !== o.directoryId) throw new OidcError('failed', 'The sign-in could not be verified');
    const raw = typeof payload.email === 'string' ? payload.email : payload.preferred_username;
    email = typeof raw === 'string' ? raw.toLowerCase() : '';
    const domain = EMAIL.exec(email)?.[1]?.toLowerCase();
    if (!domain || !allowed.includes(domain))
      throw new OidcError('domain', 'That account is not one of the college’s');
  }
  const name =
    typeof payload.name === 'string' && payload.name.trim()
      ? payload.name.trim()
      : (email.split('@')[0] ?? email);
  return { subject: sub, email, name };
}

/** Exchanges the authorization code for tokens (client secret and the PKCE verifier). */
export async function exchangeCode(
  fetchImpl: typeof fetch,
  tokenUrl: string,
  p: { clientId: string; clientSecret: string; code: string; redirectUri: string; codeVerifier: string },
): Promise<string> {
  let res: Response;
  try {
    res = await fetchImpl(tokenUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: p.code,
        redirect_uri: p.redirectUri,
        client_id: p.clientId,
        client_secret: p.clientSecret,
        code_verifier: p.codeVerifier,
      }).toString(),
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new OidcError('failed', 'The identity provider could not be reached');
  }
  const json = (await res.json().catch(() => null)) as { id_token?: unknown } | null;
  if (!res.ok || typeof json?.id_token !== 'string')
    throw new OidcError('failed', 'The sign-in was not accepted');
  return json.id_token;
}
