import { Schema, type InferSchemaType, type Types } from 'mongoose';
import { BRANCHES, EVENT_AUDIENCES, EVENT_KINDS, EVENT_MODES, RSVP_STATUSES } from '@campuslink/shared';
import { defineTenantModel, baseSchemaOptions } from '../../db/models.js';
import { removalFragment } from '../../db/fragments.js';

/** A meetup, talk, placement drive, workshop, AMA or office hours. */
const eventSchema = new Schema(
  {
    title: { type: String, required: true, maxlength: 120 },
    description: { type: String, required: true, maxlength: 4000 },
    kind: { type: String, enum: EVENT_KINDS, required: true },
    mode: { type: String, enum: EVENT_MODES, required: true },
    startsAt: { type: Date, required: true },
    endsAt: { type: Date, required: true },
    location: { type: String, default: '', maxlength: 200 },
    onlineUrl: { type: String, default: null },
    capacity: { type: Number, default: null, min: 1 },
    audience: { type: String, enum: EVENT_AUDIENCES, default: 'everyone' },
    branches: { type: [{ type: String, enum: BRANCHES }], default: [] },
    hostId: { type: Schema.Types.ObjectId, required: true },
    status: { type: String, enum: ['scheduled', 'cancelled'], default: 'scheduled' },
    /** Bumped on every change; delayed reminders carry it and no-op when it changed. */
    version: { type: Number, default: 1 },
    /** Seats taken, kept in step with "going" RSVPs by conditional updates (capacity is atomic). */
    goingCount: { type: Number, default: 0, min: 0 },
    removal: removalFragment,
    /** Weekly office hours (prompt 2, G6): repeat until a date; each instance makes the next one. */
    recurrence: {
      type: new Schema(
        { weekly: { type: Boolean, required: true }, until: { type: Date, required: true } },
        { _id: false, strict: 'throw' },
      ),
      default: null,
    },
    /** The first instance of a weekly series (null for a one-off event). */
    seriesId: { type: Schema.Types.ObjectId, default: null },
  },
  baseSchemaOptions,
);
eventSchema.index({ tenantId: 1, status: 1, startsAt: 1 });
// One instance per series and start: the job that makes the next one can run twice safely.
eventSchema.index(
  { tenantId: 1, seriesId: 1, startsAt: 1 },
  { unique: true, partialFilterExpression: { seriesId: { $type: 'objectId' } } },
);
eventSchema.index({ tenantId: 1, status: 1, endsAt: -1 });
eventSchema.index({ tenantId: 1, hostId: 1, startsAt: -1 });
eventSchema.index(
  { tenantId: 1, title: 'text', description: 'text' },
  { name: 'event_search', weights: { title: 5, description: 1 } },
);
export type EventDoc = InferSchemaType<typeof eventSchema> & { _id: Types.ObjectId; createdAt: Date };
export const EventModel = defineTenantModel('Event', eventSchema);

const rsvpSchema = new Schema(
  {
    eventId: { type: Schema.Types.ObjectId, required: true },
    userId: { type: Schema.Types.ObjectId, required: true },
    status: { type: String, enum: RSVP_STATUSES, required: true },
    /** Waitlist order. */
    queuedAt: { type: Date, required: true },
    checkedIn: { type: Boolean, default: false },
  },
  baseSchemaOptions,
);
rsvpSchema.index({ tenantId: 1, eventId: 1, userId: 1 }, { unique: true });
rsvpSchema.index({ tenantId: 1, eventId: 1, status: 1, queuedAt: 1 });
rsvpSchema.index({ tenantId: 1, userId: 1, status: 1 });
export type RsvpDoc = InferSchemaType<typeof rsvpSchema> & { _id: Types.ObjectId };
export const EventRsvpModel = defineTenantModel('EventRsvp', rsvpSchema);

/** Live Q&A queue for AMAs, office hours and talks. */
const questionSchema = new Schema(
  {
    eventId: { type: Schema.Types.ObjectId, required: true },
    authorId: { type: Schema.Types.ObjectId, required: true },
    body: { type: String, required: true, maxlength: 500 },
    votes: { type: Number, default: 0, min: 0 },
    status: { type: String, enum: ['open', 'answered', 'hidden', 'removed'], default: 'open' },
    removal: removalFragment,
  },
  baseSchemaOptions,
);
questionSchema.index({ tenantId: 1, eventId: 1, status: 1, votes: -1 });
questionSchema.index({ tenantId: 1, authorId: 1 });
export type EventQuestionDoc = InferSchemaType<typeof questionSchema> & {
  _id: Types.ObjectId;
  createdAt: Date;
};
export const EventQuestionModel = defineTenantModel('EventQuestion', questionSchema);

const voteSchema = new Schema(
  {
    questionId: { type: Schema.Types.ObjectId, required: true },
    userId: { type: Schema.Types.ObjectId, required: true },
  },
  baseSchemaOptions,
);
voteSchema.index({ tenantId: 1, questionId: 1, userId: 1 }, { unique: true });
export const EventQuestionVoteModel = defineTenantModel('EventQuestionVote', voteSchema);

/** A member follows a host's office hours and hears when a new one is scheduled (prompt 2, G6). */
const subscriptionSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, required: true },
    hostId: { type: Schema.Types.ObjectId, required: true },
  },
  baseSchemaOptions,
);
subscriptionSchema.index({ tenantId: 1, userId: 1, hostId: 1 }, { unique: true });
subscriptionSchema.index({ tenantId: 1, hostId: 1 });
export type OfficeHoursSubscriptionDoc = InferSchemaType<typeof subscriptionSchema> & {
  _id: Types.ObjectId;
  createdAt: Date;
};
export const OfficeHoursSubscriptionModel = defineTenantModel('OfficeHoursSubscription', subscriptionSchema);
