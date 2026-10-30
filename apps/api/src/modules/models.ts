// Registers every model so index sync and the tenancy guard test see all of them.
export { TenantModel } from './tenants/tenant.model.js';
export { MigrationModel } from './platform/migration.model.js';
export {
  ChannelMessageModel,
  ChannelUsageModel,
  WebhookReceiptModel,
} from './notifications/channels/channel.model.js';
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
export { InviteLinkModel, JoinCodeModel } from './verification/onboarding.model.js';
export { IdempotencyModel } from './idempotency/idempotency.model.js';
export { MentorProfileModel, MenteePrefsModel } from './mentorship/mentor.model.js';
export { MentorshipRequestModel } from './mentorship/request.model.js';
export { MentorReviewModel } from './mentorship/review.model.js';
export {
  AcademicRecordModel,
  DriveRegistrationModel,
  OfferModel,
  PlacementCompanyModel,
  PlacementDriveModel,
} from './placements/placements.model.js';
export { ExamQualificationModel, HigherStudyModel, VentureModel } from './placements/outcomes.model.js';
export { ProductEventDailyModel, ProductEventModel } from './insights/insights.model.js';
export { BookingModel, FeedbackModel } from './sessions/booking.model.js';
export { ConversationModel, MessageModel } from './messaging/conversation.model.js';
export {
  NotificationModel,
  NotificationPrefsModel,
  PushSubscriptionModel,
} from './notifications/notification.model.js';
export { BlockModel, ReportModel } from './moderation/safety.model.js';
export { PostModel, CommentModel, ReactionModel, SaveModel, PollVoteModel } from './feed/post.model.js';
export { StoryModel, FollowModel, OneUsefulThingModel } from './feed/story.model.js';
export { QuestionModel, AnswerModel, AnswerVoteModel } from './qa/question.model.js';
export { ContentSourceModel, ContentItemModel } from './content-sources/source.model.js';
export { ModerationActionModel, AppealModel } from './moderation/moderation.model.js';
export { JobModel, SavedJobModel, JobAlertModel } from './jobs/job.model.js';
export { JobSourceModel } from './job-sources/job-source.model.js';
export { ReferralPrefsModel, ReferralRequestModel } from './referrals/referral.model.js';
export {
  RoadmapModel,
  RoadmapVersionModel,
  RoadmapProgressModel,
  RoadmapCommentModel,
} from './roadmaps/roadmap.model.js';
export {
  XpEventModel,
  UserBadgeModel,
  GamificationPrefsModel,
  RewardModel,
  RedemptionModel,
} from './gamification/gamification.model.js';
export {
  EventModel,
  EventRsvpModel,
  EventQuestionModel,
  EventQuestionVoteModel,
} from './events/event.model.js';
export {
  SubjectModel,
  SyllabusUnitModel,
  SyllabusTopicModel,
  SubjectEnrollmentModel,
} from './study/subject.model.js';
export { AiSettingsModel } from './study/ai-settings.model.js';
export { AiUsageModel } from './study/ai-usage.model.js';
export {
  MaterialModel,
  MaterialJobModel,
  MaterialPageModel,
  ContentChunkModel,
  VideoSegmentModel,
  MaterialViewStatModel,
} from './study/material.model.js';
export {
  ChatSessionModel,
  ChatMessageModel,
  UnansweredQuestionModel,
  FlashcardDeckModel,
} from './study/chat.model.js';
export {
  PlanSettingModel,
  InvoiceCounterModel,
  InvoiceModel,
  PaymentModel,
} from './billing/billing.model.js';
