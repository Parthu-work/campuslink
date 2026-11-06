import { Schema, type Types } from 'mongoose';
import {
  BRANCHES,
  CIRCLE_KINDS,
  CIRCLE_STATUSES,
  STUDY_GROUP_MAX,
  type Branch,
  type CircleKind,
  type CircleStatus,
  type QuizQuestion,
} from '@campuslink/shared';
import { baseSchemaOptions, defineTenantModel } from '../../db/models.js';

/**
 * Circles (prompt 2, G7): communities per batch, branch, club or interest. Their posts, questions
 * and events are the feed's, Q&A's and events' own documents carrying a `circleId`, shown only to
 * members; this collection holds the circle and its membership.
 */
export interface CircleDoc {
  _id: Types.ObjectId;
  name: string;
  kind: CircleKind;
  description: string;
  branch: Branch | null;
  gradYear: number | null;
  status: CircleStatus;
  createdBy: Types.ObjectId | null;
  decidedBy: Types.ObjectId | null;
  members: number;
  createdAt: Date;
}
const circleSchema = new Schema(
  {
    name: { type: String, required: true, maxlength: 60 },
    kind: { type: String, enum: CIRCLE_KINDS, required: true },
    description: { type: String, default: '', maxlength: 500 },
    branch: { type: String, enum: [...BRANCHES, null], default: null },
    gradYear: { type: Number, default: null },
    status: { type: String, enum: CIRCLE_STATUSES, required: true },
    createdBy: { type: Schema.Types.ObjectId, default: null },
    decidedBy: { type: Schema.Types.ObjectId, default: null },
    members: { type: Number, default: 0, min: 0 },
  },
  baseSchemaOptions,
);
circleSchema.index({ tenantId: 1, status: 1, kind: 1, name: 1 });
circleSchema.index({ tenantId: 1, createdBy: 1, status: 1 });
export const CircleModel = defineTenantModel('Circle', circleSchema);

export interface CircleMemberDoc {
  _id: Types.ObjectId;
  circleId: Types.ObjectId;
  userId: Types.ObjectId;
  /** The creator leads; leads can remove members. */
  role: 'member' | 'lead';
  createdAt: Date;
}
const memberSchema = new Schema(
  {
    circleId: { type: Schema.Types.ObjectId, required: true },
    userId: { type: Schema.Types.ObjectId, required: true },
    role: { type: String, enum: ['member', 'lead'], default: 'member' },
  },
  baseSchemaOptions,
);
memberSchema.index({ tenantId: 1, circleId: 1, userId: 1 }, { unique: true });
memberSchema.index({ tenantId: 1, userId: 1 });
export const CircleMemberModel = defineTenantModel('CircleMember', memberSchema);

/**
 * A study group on one study subject: 3 to 6 members, a shared question list, a session slot,
 * and quizzes a member shared from the study assistant's /quiz for everyone to take.
 */
export interface StudyGroupDoc {
  _id: Types.ObjectId;
  subjectId: Types.ObjectId;
  subjectName: string;
  name: string;
  memberIds: Types.ObjectId[];
  createdBy: Types.ObjectId | null;
  formedAt: Date | null;
  slot: { at: Date; place: string } | null;
  questions: { _id: Types.ObjectId; text: string; by: Types.ObjectId | null; done: boolean }[];
  quizzes: {
    _id: Types.ObjectId;
    topic: string;
    sharedBy: Types.ObjectId | null;
    questions: QuizQuestion[];
    results: {
      userId: Types.ObjectId;
      correct: number;
      total: number;
      answers: (number | string)[];
      at: Date;
    }[];
    createdAt: Date;
  }[];
  createdAt: Date;
}
const studyGroupSchema = new Schema(
  {
    subjectId: { type: Schema.Types.ObjectId, required: true },
    subjectName: { type: String, required: true },
    name: { type: String, required: true, maxlength: 60 },
    memberIds: {
      type: [Schema.Types.ObjectId],
      validate: (v: unknown[]) => v.length <= STUDY_GROUP_MAX,
    },
    createdBy: { type: Schema.Types.ObjectId, default: null },
    formedAt: { type: Date, default: null },
    slot: {
      type: new Schema({ at: Date, place: { type: String, default: '' } }, { _id: false, strict: 'throw' }),
      default: null,
    },
    questions: {
      type: [
        {
          text: { type: String, required: true, maxlength: 300 },
          by: { type: Schema.Types.ObjectId, default: null },
          done: { type: Boolean, default: false },
        },
      ],
      default: [],
    },
    quizzes: {
      type: [
        new Schema(
          {
            topic: { type: String, default: '' },
            sharedBy: { type: Schema.Types.ObjectId, default: null },
            questions: { type: [Schema.Types.Mixed], default: [] },
            results: {
              type: [
                {
                  _id: false,
                  userId: Schema.Types.ObjectId,
                  correct: Number,
                  total: Number,
                  answers: [Schema.Types.Mixed],
                  at: Date,
                },
              ],
              default: [],
            },
          },
          { timestamps: { createdAt: true, updatedAt: false }, strict: 'throw' },
        ),
      ],
      default: [],
    },
  },
  baseSchemaOptions,
);
studyGroupSchema.index({ tenantId: 1, subjectId: 1, createdAt: -1 });
studyGroupSchema.index({ tenantId: 1, memberIds: 1 });
export const StudyGroupModel = defineTenantModel('StudyGroup', studyGroupSchema);
