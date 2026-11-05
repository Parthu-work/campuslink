import { Schema, type Types } from 'mongoose';
import {
  CODE_LANGUAGES,
  PRACTICE_DIFFICULTIES,
  PRACTICE_KINDS,
  PRACTICE_SET_SIZE,
  PRACTICE_SOURCES,
  PRACTICE_STATUSES,
  PRACTICE_TOPICS,
  type CodeLanguage,
  type CodeRunStatus,
  type PracticeDifficulty,
  type PracticeKind,
  type PracticeSource,
  type PracticeStatus,
  type PracticeTopic,
} from '@campuslink/shared';
import { baseSchemaOptions, defineTenantModel } from '../../db/models.js';

/**
 * The college's practice bank (prompt 2, G4). The original starter set is copied in on first use
 * (`starterRef` set) so faculty can tag, correct or retire it like any other item.
 */
export interface PracticeItemDoc {
  _id: Types.ObjectId;
  kind: PracticeKind;
  topic: PracticeTopic;
  difficulty: PracticeDifficulty;
  /** Companies as the college writes them, with their comparable keys (lib/company.ts). */
  companies: { key: string; name: string }[];
  text: string;
  code: string;
  codeLanguage: CodeLanguage | null;
  options: string[];
  answer: string;
  tolerance: number | null;
  explanation: string;
  tests: { stdin: string; expected: string }[];
  source: PracticeSource;
  status: PracticeStatus;
  starterRef: string | null;
  createdBy: Types.ObjectId | null;
  reviewedBy: Types.ObjectId | null;
  reviewedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const itemSchema = new Schema(
  {
    kind: { type: String, enum: PRACTICE_KINDS, required: true },
    topic: { type: String, enum: PRACTICE_TOPICS, required: true },
    difficulty: { type: String, enum: PRACTICE_DIFFICULTIES, default: 'medium' },
    companies: {
      type: [{ _id: false, key: { type: String, required: true }, name: { type: String, required: true } }],
      default: [],
    },
    text: { type: String, required: true, maxlength: 2000 },
    code: { type: String, default: '', maxlength: 6000 },
    codeLanguage: { type: String, enum: [...CODE_LANGUAGES, null], default: null },
    options: { type: [String], default: [] },
    answer: { type: String, default: '', maxlength: 2000 },
    tolerance: { type: Number, default: null },
    explanation: { type: String, required: true, maxlength: 2000 },
    tests: {
      type: [
        { _id: false, stdin: { type: String, default: '' }, expected: { type: String, required: true } },
      ],
      default: [],
    },
    source: { type: String, enum: PRACTICE_SOURCES, required: true },
    status: { type: String, enum: PRACTICE_STATUSES, required: true },
    starterRef: { type: String, default: null },
    createdBy: { type: Schema.Types.ObjectId, default: null },
    reviewedBy: { type: Schema.Types.ObjectId, default: null },
    reviewedAt: { type: Date, default: null },
  },
  baseSchemaOptions,
);
itemSchema.index({ tenantId: 1, status: 1, topic: 1 });
itemSchema.index({ tenantId: 1, 'companies.key': 1, status: 1 });
itemSchema.index(
  { tenantId: 1, starterRef: 1 },
  { unique: true, partialFilterExpression: { starterRef: { $type: 'string' } } },
);
itemSchema.index({ tenantId: 1, createdBy: 1 });
export const PracticeItemModel = defineTenantModel('PracticeItem', itemSchema);

/** One member's spaced-repetition state for one item (Leitner box and the day it is due again). */
export interface PracticeCardDoc {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  itemId: Types.ObjectId;
  topic: PracticeTopic;
  box: number;
  due: string;
  lastCorrect: boolean;
  reps: number;
  lapses: number;
}
const cardSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, required: true },
    itemId: { type: Schema.Types.ObjectId, required: true },
    topic: { type: String, enum: PRACTICE_TOPICS, required: true },
    box: { type: Number, required: true, min: 0 },
    due: { type: String, required: true },
    lastCorrect: { type: Boolean, required: true },
    reps: { type: Number, default: 0 },
    lapses: { type: Number, default: 0 },
  },
  baseSchemaOptions,
);
cardSchema.index({ tenantId: 1, userId: 1, itemId: 1 }, { unique: true });
cardSchema.index({ tenantId: 1, userId: 1, due: 1 });
export const PracticeCardModel = defineTenantModel('PracticeCard', cardSchema);

export interface PracticeAnswerDoc {
  index: number;
  given: string;
  correct: boolean;
  run: { status: CodeRunStatus; passed: number; total: number; message: string } | null;
  at: Date;
}
/**
 * A set of up to ten items: the day's set (one per member per day, earns XP once) or a company
 * prep set. Answers keep the topic so mastery is counted without reading the bank.
 */
export interface PracticeSetDoc {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  kind: 'daily' | 'company';
  day: string;
  companyKey: string | null;
  companyName: string | null;
  itemIds: Types.ObjectId[];
  topics: PracticeTopic[];
  answers: PracticeAnswerDoc[];
  completedAt: Date | null;
  createdAt: Date;
}
const setSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, required: true },
    kind: { type: String, enum: ['daily', 'company'], required: true },
    day: { type: String, required: true },
    companyKey: { type: String, default: null },
    companyName: { type: String, default: null },
    itemIds: {
      type: [Schema.Types.ObjectId],
      validate: (v: unknown[]) => v.length <= PRACTICE_SET_SIZE,
    },
    topics: { type: [String], default: [] },
    answers: {
      type: [
        {
          _id: false,
          index: { type: Number, required: true },
          given: { type: String, default: '' },
          correct: { type: Boolean, required: true },
          run: {
            type: {
              _id: false,
              status: String,
              passed: Number,
              total: Number,
              message: String,
            },
            default: null,
          },
          at: { type: Date, required: true },
        },
      ],
      default: [],
    },
    completedAt: { type: Date, default: null },
  },
  baseSchemaOptions,
);
setSchema.index(
  { tenantId: 1, userId: 1, day: 1 },
  { unique: true, partialFilterExpression: { kind: 'daily' } },
);
setSchema.index({ tenantId: 1, userId: 1, createdAt: -1 });
setSchema.index({ tenantId: 1, createdAt: -1 });
export const PracticeSetModel = defineTenantModel('PracticeSet', setSchema);
