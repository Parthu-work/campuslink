# Data model

All tenant-owned collections carry `tenantId` (stamped and filtered by the tenancy plugin), and every non-TTL index starts with `tenantId`, which is enforced by a test. Schemas use `strict: 'throw'` and timestamps.

```mermaid
erDiagram
  TENANT ||--o{ USER : has
  TENANT ||--o{ AUDIT_LOG : records
  USER ||--o{ SESSION : "signs in on"
  USER ||--o{ AUTH_TOKEN : "verifies / resets with"
  USER ||--o{ CONSENT : grants
  TENANT {
    ObjectId _id
    string slug UK
    enum kind "college | platform"
    enum status "active | suspended"
    object branding
    object features
    string[] allowedEmailDomains
    object permissionOverrides
    object subscription "plan, seatLimit, renewalDate"
    object retention
  }
  USER {
    ObjectId tenantId
    string email "unique per tenant"
    string passwordHash "argon2id"
    string[] roles
    string[] capabilities
    enum status
    bool verified "college verification"
    date emailVerifiedAt
    date ageDeclaredAt
    string phoneEnc "AES-GCM (Phase 2)"
    object mfa "secretEnc, lastTimeStep, recoveryCodeHashes"
    int tokenVersion
  }
  SESSION {
    ObjectId tenantId
    ObjectId userId
    string currentTokenHash "SHA-256"
    string[] usedTokenHashes "reuse detection"
    string device
    string createdIpPrefix
    date expiresAt "TTL +30d"
    date revokedAt
  }
  AUTH_TOKEN {
    ObjectId tenantId
    ObjectId userId
    enum purpose "email_verify | password_reset"
    string tokenHash
    date expiresAt "TTL"
    date usedAt
  }
  CONSENT {
    ObjectId tenantId
    ObjectId userId
    enum purpose
    int version
    string noticeVersion
    bool granted
  }
  AUDIT_LOG {
    ObjectId tenantId
    ObjectId actorId
    string action
    string targetType
    string targetId
    object meta "non-personal"
    string ipPrefix
  }
```

The Tenant registry is the only platform-level collection (allowlisted in `db/models.ts`). Super admins are users of the `platform` tenant (`admin.<root>`).

The remaining collections from the spec are added by their phases: profiles and imports (2), mentorship and messaging (3), feed and content (4), jobs (5), roadmaps (6), gamification and events (7).
