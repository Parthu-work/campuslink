// Registers every model so index sync and the tenancy guard test see all of them.
export { TenantModel } from './tenants/tenant.model.js';
export { UserModel } from './auth/user.model.js';
export { SessionModel } from './auth/session.model.js';
export { AuthTokenModel } from './auth/auth-token.model.js';
export { AuditModel } from './audit/audit.model.js';
export { ConsentModel } from './consent/consent.model.js';
export { FileModel } from './files/file.model.js';
export { WhitelistModel } from './imports/whitelist.model.js';
export { ImportJobModel, ImportPreviewModel } from './imports/import-job.model.js';
export { ProfileModel } from './profiles/profile.model.js';
export {
  OtpChallengeModel,
  VerificationRequestModel,
  InviteModel,
} from './verification/verification.model.js';
