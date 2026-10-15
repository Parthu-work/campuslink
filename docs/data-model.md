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

## People (Phase 2)

```mermaid
erDiagram
  USER ||--|| PROFILE : "has (kept in sync)"
  USER ||--o{ FILE : owns
  WHITELIST_RECORD |o--o| USER : "claimed by"
  IMPORT_JOB ||--o{ WHITELIST_RECORD : "creates / updates"
  USER ||--o{ OTP_CHALLENGE : requests
  USER ||--o{ VERIFICATION_REQUEST : submits
  VERIFICATION_REQUEST ||--|| FILE : "ID photo"
  WHITELIST_RECORD {
    ObjectId tenantId
    string rollNumber "unique per tenant"
    string name
    enum branch
    int gradYear
    enum kind "student | alumni"
    string emailEnc "AES-GCM"
    string emailIndex "HMAC blind index"
    string phoneEnc "AES-GCM"
    string phoneIndex
    enum status "unclaimed | claimed"
    ObjectId claimedBy
    enum source "import | manual | invite"
    ObjectId lastImportJobId
  }
  IMPORT_PREVIEW {
    ObjectId tenantId
    enum sourceKind "csv | xlsx | gsheet | rest"
    ObjectId fileId
    string[] headers
    date expiresAt "TTL 2h"
  }
  IMPORT_JOB {
    ObjectId tenantId
    ObjectId createdBy
    object mapping
    bool dryRun
    enum status "queued | running | completed | failed | rolled_back"
    int progress
    object counts "created, updated, unchanged, skippedClaimed, errors"
    object[] rowErrors "row, field, message (no values)"
    object[] changes "before-images for rollback (select: false)"
    object rollback
  }
  OTP_CHALLENGE {
    ObjectId tenantId
    ObjectId userId
    enum purpose "roll_claim | company_email"
    string codeHash
    int attempts
    date expiresAt "10 min"
    date purgeAt "TTL 24h"
  }
  VERIFICATION_REQUEST {
    ObjectId tenantId
    ObjectId userId
    enum method "id_card"
    string rollNumber
    ObjectId fileId
    enum status "pending | approved | rejected"
    ObjectId reviewerId
  }
  INVITE {
    ObjectId tenantId
    string emailIndex "unique per tenant"
    enum kind
    date expiresAt "TTL 30d"
  }
  PROFILE {
    ObjectId tenantId
    ObjectId userId "unique per tenant"
    string name "denormalised from USER"
    string[] roles
    bool verified
    string headline
    string company
    string[] skills
    string[] topics
    object[] links "https, allowlisted hosts"
    string phoneEnc "AES-GCM"
    object companyVerified "company, domain, verifiedAt"
    object visibility "per field: members | alumni_staff | only_me"
  }
  FILE {
    ObjectId tenantId
    ObjectId ownerId
    enum purpose "avatar | id_card | import_source"
    string storageKey "random"
    enum scanStatus
    date deleteAfter "retention purge"
  }
```

The profile is a read model for the directory and search: `ProfilesService.sync()` copies name, roles, status and verification from the user whenever they change, and only verified, active members appear. Its `$text` index is used only through `db/search.ts`.

The remaining collections from the spec are added by their phases: mentorship and messaging (3), feed and content (4), jobs (5), roadmaps (6), gamification and events (7).
