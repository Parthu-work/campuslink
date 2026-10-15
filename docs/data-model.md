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

## Mentorship (Phase 3)

```mermaid
erDiagram
  USER ||--o| MENTOR_PROFILE : "mentors with"
  USER ||--o| MENTEE_PREFS : "matches with"
  USER ||--o{ MENTORSHIP_REQUEST : "sends / receives"
  MENTORSHIP_REQUEST ||--o| BOOKING : "books"
  MENTORSHIP_REQUEST }o--|| CONVERSATION : "opens on accept"
  BOOKING ||--o| SESSION_FEEDBACK : "rated by mentee"
  CONVERSATION ||--o{ MESSAGE : contains
  MESSAGE |o--o| FILE : attachment
  USER ||--o{ NOTIFICATION : receives
  USER ||--o| NOTIFICATION_PREFS : sets
  USER ||--o{ PUSH_SUBSCRIPTION : "registers"
  USER ||--o{ BLOCK : blocks
  USER ||--o{ REPORT : files
  MENTOR_PROFILE {
    ObjectId tenantId
    ObjectId userId "unique per tenant"
    bool accepting "pause switch"
    int weeklyCap
    enum audience "students | alumni | both"
    object[] sessionTypes "type, enabled, durationMin"
    int minNoticeHours
    int horizonDays
    int bufferMin
    string timezone "IANA"
    object[] weekly "day, windows (HH:mm)"
    object[] exceptions "date, windows (empty = off)"
  }
  MENTEE_PREFS {
    ObjectId tenantId
    ObjectId userId
    string[] goals "private"
    string[] targetCompanies "private"
  }
  MENTORSHIP_REQUEST {
    ObjectId tenantId
    ObjectId menteeId
    ObjectId mentorId
    enum sessionType
    string goal
    string background
    string need
    date slotStart
    enum status "pending | accepted | declined | withdrawn | expired"
    enum declineTemplate
    date expiresAt "7 days"
    ObjectId bookingId
    ObjectId conversationId
  }
  BOOKING {
    ObjectId tenantId
    ObjectId mentorId
    ObjectId menteeId
    date start "UTC"
    date end
    enum status "scheduled | completed | cancelled | no_show"
    string[] holds "user|block, unique while scheduled"
    string room "random, rotated on reschedule"
    int version
    int rescheduleCount "max 2"
    bool lateCancel
    enum noShowBy
  }
  SESSION_FEEDBACK {
    ObjectId tenantId
    ObjectId bookingId "unique"
    int rating "1-5"
    string[] tags
    string comment "mentor + admins only"
  }
  CONVERSATION {
    ObjectId tenantId
    string pairKey "unique per tenant"
    enum status "open | blocked"
    object[] reads "read receipts"
    object[] emailedAt "email throttle"
  }
  MESSAGE {
    ObjectId tenantId
    ObjectId conversationId
    ObjectId senderId
    string bodyEnc "AES-GCM"
    object attachment "fileId, name, mime, size"
  }
  NOTIFICATION {
    ObjectId tenantId
    ObjectId userId
    enum type
    map data "ids and names only"
    date readAt
    date expiresAt "TTL 90 days"
  }
  PUSH_SUBSCRIPTION {
    ObjectId tenantId
    ObjectId userId
    string endpointEnc "AES-GCM"
    string endpointIndex "blind index, unique"
    string keysEnc
  }
  REPORT {
    ObjectId tenantId
    ObjectId reporterId
    enum targetType "user | message | request"
    ObjectId subjectUserId
    enum reason
    string snapshot "reported text only"
    enum status "open | resolved"
  }
```

Availability is embedded in `mentorProfiles` (one document, changed atomically with the settings) rather than a separate `availability` collection. `idempotencyRecords` (TTL 24 h) store replayable responses for `Idempotency-Key`.

The remaining collections from the spec are added by their phases: feed and content (4), jobs (5), roadmaps (6), gamification and events (7).
