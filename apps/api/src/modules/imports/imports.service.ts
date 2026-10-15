import { Types } from 'mongoose';
import { fileTypeFromBuffer } from 'file-type';
import {
  BRANCHES,
  ErrorCode,
  IMPORT_FIELDS,
  email as emailSchema,
  gradYear as gradYearSchema,
  phone as phoneSchema,
  rollNumber as rollSchema,
  type Branch,
  type ImportField,
  type ImportMapping,
  type ImportPreview,
  type ImportSourceBody,
} from '@campuslink/shared';
import { WhitelistModel } from './whitelist.model.js';
import { ImportJobModel, ImportPreviewModel } from './import-job.model.js';
import { csvAdapter } from './adapters/csv.js';
import { xlsxAdapter } from './adapters/xlsx.js';
import { googleSheetAdapter, restJsonAdapter, type Fetcher } from './adapters/remote.js';
import { SourceError, type SourceRows } from './adapters/types.js';
import type { FilesService } from '../files/files.service.js';
import type { FieldCipher } from '../../lib/crypto.js';
import type { JobQueue } from '../../lib/jobs.js';
import { requireTenantId } from '../../lib/context.js';
import { AppError, badRequest, conflict, notFound } from '../../lib/errors.js';
import { audit, type RequestMetaLite } from '../audit/audit.service.js';

export const IMPORT_JOB = 'imports.run';
const PREVIEW_TTL_MS = 2 * 3600_000;
const MAX_STORED_ERRORS = 5000;

const SYNONYMS: Record<ImportField, string[]> = {
  rollNumber: [
    'roll',
    'roll no',
    'roll number',
    'rollno',
    'roll_no',
    'hall ticket',
    'hall ticket no',
    'htno',
    'ht no',
    'registration no',
    'reg no',
    'regd no',
    'admission no',
    'pin',
  ],
  name: ['name', 'student name', 'full name', 'candidate name', 'alumni name'],
  branch: ['branch', 'department', 'dept', 'stream', 'discipline', 'programme', 'program'],
  gradYear: [
    'batch',
    'passout',
    'pass out',
    'passout year',
    'year of passing',
    'graduation year',
    'grad year',
    'passing year',
    'yop',
  ],
  email: ['email', 'e-mail', 'email id', 'mail', 'email address'],
  phone: ['phone', 'mobile', 'mobile no', 'mobile number', 'contact', 'contact no', 'phone number'],
  kind: ['type', 'kind', 'category', 'student type', 'status'],
};
const BRANCH_SYNONYMS: [RegExp, Branch][] = [
  [/^(cse|cs|computer science( and engineering| & engineering| engineering)?|computer)$/i, 'CSE'],
  [/^(it|information technology)$/i, 'IT'],
  [/^(ece|electronics( and | & )communication( engineering)?)$/i, 'ECE'],
  [/^(eee|electrical( and | & )electronics( engineering)?|electrical)$/i, 'EEE'],
  [/^(mech|me|mechanical( engineering)?)$/i, 'MECH'],
  [/^(civil|ce|civil engineering)$/i, 'CIVIL'],
  [/^(chem|che|chemical( engineering)?)$/i, 'CHEM'],
  [/^(aiml|ai ?& ?ml|cse ?\(ai ?& ?ml\)|artificial intelligence( and | & )machine learning)$/i, 'AIML'],
  [/^(ds|data science|cse ?\(ds\))$/i, 'DS'],
];

export function suggestMapping(headers: string[]): ImportMapping['columns'] {
  const norm = (s: string) => s.toLowerCase().replace(/[._]/g, ' ').replace(/\s+/g, ' ').trim();
  const out: ImportMapping['columns'] = {};
  for (const field of IMPORT_FIELDS) {
    const hit = headers.find((h) => SYNONYMS[field].includes(norm(h)));
    if (hit) out[field] = hit;
  }
  return out;
}

export function normaliseBranch(v: string): Branch {
  if ((BRANCHES as readonly string[]).includes(v.toUpperCase())) return v.toUpperCase() as Branch;
  return BRANCH_SYNONYMS.find(([rx]) => rx.test(v.trim()))?.[1] ?? 'OTHER';
}

interface RowOk {
  rollNumber: string;
  name: string;
  branch: Branch | null;
  gradYear: number | null;
  kind: 'student' | 'alumni';
  email: string | null;
  phone: string | null;
}
type RowResult = { ok: true; value: RowOk } | { ok: false; errors: { field: string; message: string }[] };

/** Validates and normalises one source row according to the admin's mapping. */
export function mapRow(row: Record<string, string>, mapping: ImportMapping, now = new Date()): RowResult {
  const get = (f: ImportField) => (mapping.columns[f] ? (row[mapping.columns[f]] ?? '').trim() : '');
  const errors: { field: string; message: string }[] = [];
  const roll = rollSchema.safeParse(get('rollNumber'));
  if (!roll.success)
    errors.push({
      field: 'rollNumber',
      message: get('rollNumber') ? 'Invalid roll number' : 'Missing roll number',
    });
  const name = get('name').replace(/\s+/g, ' ');
  if (name.length < 2 || name.length > 120)
    errors.push({ field: 'name', message: name ? 'Name must be 2–120 characters' : 'Missing name' });
  let gradYear: number | null = null;
  const gyRaw = get('gradYear');
  if (gyRaw) {
    const year = /(\d{4})(?!.*\d{4})/.exec(gyRaw)?.[1];
    const gy = gradYearSchema.safeParse(year);
    if (gy.success) gradYear = gy.data;
    else errors.push({ field: 'gradYear', message: 'Invalid graduation year' });
  }
  let emailVal: string | null = null;
  if (get('email')) {
    const e = emailSchema.safeParse(get('email'));
    if (e.success) emailVal = e.data;
    else errors.push({ field: 'email', message: 'Invalid email' });
  }
  let phoneVal: string | null = null;
  if (get('phone')) {
    const p = phoneSchema.safeParse(get('phone'));
    if (p.success) phoneVal = p.data;
    else errors.push({ field: 'phone', message: 'Invalid mobile number' });
  }
  let kind: 'student' | 'alumni' | null = null;
  const kindRaw = get('kind').toLowerCase();
  if (/alum|pass(ed)? ?out|graduate/.test(kindRaw)) kind = 'alumni';
  else if (/student|current|studying/.test(kindRaw)) kind = 'student';
  else if (mapping.defaultKind !== 'derive') kind = mapping.defaultKind;
  else if (gradYear) {
    // Indian academic year: final results by July. Graduation year in the past (or this year after June) → alumni.
    const y = now.getUTCFullYear();
    kind = gradYear < y || (gradYear === y && now.getUTCMonth() >= 6) ? 'alumni' : 'student';
  } else errors.push({ field: 'kind', message: 'Add a type column or graduation year' });

  if (errors.length || !roll.success || !kind) return { ok: false, errors };
  return {
    ok: true,
    value: {
      rollNumber: roll.data,
      name,
      branch: get('branch') ? normaliseBranch(get('branch')) : null,
      gradYear,
      kind,
      email: emailVal,
      phone: phoneVal,
    },
  };
}

/** CSV cell escaping incl. formula-injection guard (cells starting with = + - @ tab CR). */
export function csvCell(v: string | number): string {
  let s = String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export interface ImportsDeps {
  files: FilesService;
  cipher: FieldCipher;
  jobs: JobQueue;
  fetcher: Fetcher;
}

export class ImportsService {
  constructor(private readonly d: ImportsDeps) {}

  // ── preview ─────────────────────────────
  private async previewFrom(
    userId: string,
    kind: 'csv' | 'xlsx' | 'gsheet' | 'rest',
    label: string,
    table: SourceRows,
  ): Promise<ImportPreview> {
    if (!table.rows.length) throw badRequest('No data rows found');
    const blob = Buffer.from(JSON.stringify(table.rows));
    const file = await this.d.files.storeImportSource(userId, blob, 'application/json');
    const p = await ImportPreviewModel.create({
      createdBy: new Types.ObjectId(userId),
      sourceKind: kind,
      sourceLabel: label.slice(0, 200),
      fileId: new Types.ObjectId(file.id),
      headers: table.headers,
      totalRows: table.rows.length,
      expiresAt: new Date(Date.now() + PREVIEW_TTL_MS),
    });
    return {
      previewId: String(p._id),
      headers: table.headers,
      rows: table.rows.slice(0, 10),
      totalRows: table.rows.length,
      suggestedMapping: suggestMapping(table.headers),
    };
  }

  async previewUpload(userId: string, file: Express.Multer.File | undefined): Promise<ImportPreview> {
    if (!file) throw badRequest('Choose a CSV or Excel file');
    const type = await fileTypeFromBuffer(file.buffer);
    const isXlsx = type?.ext === 'xlsx';
    if (type && !isXlsx) throw new AppError(415, ErrorCode.VALIDATION_FAILED, 'Upload a .csv or .xlsx file');
    try {
      const table = isXlsx ? await xlsxAdapter.read(file.buffer) : await csvAdapter.read(file.buffer);
      return this.previewFrom(
        userId,
        isXlsx ? 'xlsx' : 'csv',
        file.originalname.replace(/[^\w .()-]/g, '_') || 'upload',
        table,
      );
    } catch (e) {
      if (e instanceof SourceError) throw badRequest(e.message);
      throw e;
    }
  }

  async previewRemote(userId: string, body: ImportSourceBody): Promise<ImportPreview> {
    try {
      if (body.kind === 'gsheet') {
        const table = await googleSheetAdapter(this.d.fetcher).read(body.url);
        return this.previewFrom(userId, 'gsheet', 'Google Sheet', table);
      }
      const table = await restJsonAdapter(this.d.fetcher).read({
        url: body.url,
        recordsPath: body.recordsPath,
        bearerToken: body.bearerToken,
      });
      return this.previewFrom(userId, 'rest', new URL(body.url).hostname, table);
    } catch (e) {
      if (e instanceof SourceError) throw badRequest(e.message);
      throw e;
    }
  }

  // ── start / run ─────────────────────────────
  async start(
    userId: string,
    previewId: string,
    mapping: ImportMapping,
    dryRun: boolean,
    meta: RequestMetaLite,
  ) {
    const missing = (['rollNumber', 'name'] as const).filter((f) => !mapping.columns[f]);
    if (missing.length) throw badRequest('Map the roll number and name columns', missing);
    const preview = await ImportPreviewModel.findOne({ _id: previewId, createdBy: userId }).lean();
    if (!preview) throw notFound('Preview (it may have expired; upload again)');
    for (const col of Object.values(mapping.columns))
      if (col && !preview.headers.includes(col)) throw badRequest(`Unknown column “${col}”`);
    if (await ImportJobModel.exists({ status: { $in: ['queued', 'running'] } }))
      throw conflict('Another import is still running. Wait for it to finish.');

    const job = await ImportJobModel.create({
      createdBy: new Types.ObjectId(userId),
      sourceKind: preview.sourceKind,
      sourceLabel: preview.sourceLabel,
      fileId: preview.fileId,
      mapping,
      dryRun,
      counts: { total: preview.totalRows },
    });
    await ImportPreviewModel.deleteOne({ _id: previewId });
    await audit.record(
      {
        action: 'import.started',
        actorId: userId,
        targetType: 'import',
        targetId: String(job._id),
        meta: { rows: preview.totalRows, dryRun, source: preview.sourceKind },
      },
      meta,
    );
    await this.d.jobs.enqueue(
      IMPORT_JOB,
      { tenantId: String(requireTenantId()), jobId: String(job._id) },
      { jobId: String(job._id) },
    );
    return { id: String(job._id) };
  }

  /** Background job body. Runs inside the tenant context (set by the queue). */
  async run(jobId: string, progress: (pct: number) => Promise<void>): Promise<void> {
    const job = await ImportJobModel.findOneAndUpdate(
      { _id: jobId, status: 'queued' },
      { $set: { status: 'running', startedAt: new Date() } },
      { new: true },
    ).lean();
    if (!job) return; // already processed (BullMQ retry or duplicate enqueue): idempotent
    try {
      const rows = JSON.parse((await this.d.files.read(String(job.fileId))).toString('utf8')) as Record<
        string,
        string
      >[];
      const mapping = job.mapping as ImportMapping;
      const counts = {
        total: rows.length,
        created: 0,
        updated: 0,
        unchanged: 0,
        skippedClaimed: 0,
        errors: 0,
      };
      const rowErrors: { row: number; field: string; message: string }[] = [];
      const changes: { recordId: Types.ObjectId; op: 'create' | 'update'; before: unknown }[] = [];
      const seen = new Map<string, number>();
      const addError = (row: number, field: string, message: string) => {
        counts.errors++;
        if (rowErrors.length < MAX_STORED_ERRORS) rowErrors.push({ row, field, message });
      };

      for (let i = 0; i < rows.length; i++) {
        if (i > 0 && i % 200 === 0) {
          const pct = Math.round((i / rows.length) * 100);
          await ImportJobModel.updateOne({ _id: job._id }, { $set: { progress: pct } });
          await progress(pct);
        }
        const rowNo = i + 2; // spreadsheet row number (header is row 1)
        const r = mapRow(rows[i] ?? {}, mapping);
        if (!r.ok) {
          r.errors.forEach((e) => addError(rowNo, e.field, e.message));
          continue;
        }
        const v = r.value;
        const dup = seen.get(v.rollNumber);
        if (dup) {
          addError(rowNo, 'rollNumber', `Duplicate of row ${dup}`);
          continue;
        }
        seen.set(v.rollNumber, rowNo);
        const next = {
          name: v.name,
          branch: v.branch,
          gradYear: v.gradYear,
          kind: v.kind,
          emailIndex: v.email ? this.d.cipher.blindIndex(v.email) : null,
          phoneIndex: v.phone ? this.d.cipher.blindIndex(v.phone) : null,
        };
        const existing = await WhitelistModel.findOne({ rollNumber: v.rollNumber }).lean();
        if (!existing) {
          counts.created++;
          if (!job.dryRun) {
            const created = await WhitelistModel.create({
              rollNumber: v.rollNumber,
              ...next,
              source: 'import',
              lastImportJobId: job._id,
              emailEnc: v.email ? this.d.cipher.encrypt(v.email) : null,
              phoneEnc: v.phone ? this.d.cipher.encrypt(v.phone) : null,
            });
            changes.push({ recordId: created._id, op: 'create', before: null });
          }
          continue;
        }
        const differs = (Object.keys(next) as (keyof typeof next)[]).some(
          (k) => (existing[k] ?? null) !== next[k],
        );
        if (!differs) {
          counts.unchanged++;
          continue;
        }
        if (existing.status === 'claimed') {
          counts.skippedClaimed++;
          addError(rowNo, 'rollNumber', 'Already claimed by a verified member; not changed');
          continue;
        }
        counts.updated++;
        if (!job.dryRun) {
          const before = {
            name: existing.name,
            branch: existing.branch,
            gradYear: existing.gradYear,
            kind: existing.kind,
            emailEnc: existing.emailEnc,
            emailIndex: existing.emailIndex,
            phoneEnc: existing.phoneEnc,
            phoneIndex: existing.phoneIndex,
          };
          await WhitelistModel.updateOne(
            { _id: existing._id, status: 'unclaimed' },
            {
              $set: {
                ...next,
                emailEnc: v.email ? this.d.cipher.encrypt(v.email) : null,
                phoneEnc: v.phone ? this.d.cipher.encrypt(v.phone) : null,
                lastImportJobId: job._id,
              },
            },
          );
          changes.push({ recordId: existing._id, op: 'update', before });
        }
      }
      await ImportJobModel.updateOne(
        { _id: job._id },
        { $set: { status: 'completed', progress: 100, counts, rowErrors, changes, finishedAt: new Date() } },
      );
      await audit.record({
        action: 'import.completed',
        actorId: String(job.createdBy),
        targetType: 'import',
        targetId: String(job._id),
        meta: { ...counts, dryRun: job.dryRun },
      });
    } catch (err) {
      await ImportJobModel.updateOne(
        { _id: job._id },
        {
          $set: {
            status: 'failed',
            failureReason: 'The import could not be completed. Try again or contact support.',
            finishedAt: new Date(),
          },
        },
      );
      throw err;
    } finally {
      // Minimisation: the source rows are not needed once processed.
      if (job.fileId) await this.d.files.remove(job.fileId).catch(() => undefined);
    }
  }

  // ── read / report / rollback ─────────────────────────────
  async list() {
    const jobs = await ImportJobModel.find({}).sort({ _id: -1 }).limit(20).select('-rowErrors').lean();
    return jobs.map(({ mapping: _m, ...j }) => ({ ...j, id: String(j._id) }));
  }

  async get(id: string) {
    const j = await ImportJobModel.findById(id).lean();
    if (!j) throw notFound('Import');
    return { ...j, id: String(j._id), rowErrors: j.rowErrors.slice(0, 50) };
  }

  async errorReportCsv(id: string): Promise<string> {
    const j = await ImportJobModel.findById(id).select('rowErrors').lean();
    if (!j) throw notFound('Import');
    return (
      [
        'row,field,problem',
        ...j.rowErrors.map((e: { row?: number | null; field?: string | null; message?: string | null }) =>
          [e.row ?? '', e.field ?? '', e.message ?? ''].map((c) => csvCell(c)).join(','),
        ),
      ].join('\r\n') + '\r\n'
    );
  }

  /** Only the most recent applied import can be rolled back; claimed records are never removed. */
  async rollback(id: string, actorId: string, meta: RequestMetaLite) {
    const latest = await ImportJobModel.findOne({
      dryRun: false,
      status: { $in: ['completed', 'rolled_back'] },
    })
      .sort({ _id: -1 })
      .select('+changes')
      .lean();
    if (!latest || String(latest._id) !== id)
      throw conflict('Only the most recent import can be rolled back');
    if (latest.status !== 'completed') throw conflict('This import was already rolled back');
    let removed = 0,
      restored = 0,
      keptClaimed = 0;
    for (const c of [...latest.changes].reverse()) {
      if (c.op === 'create') {
        const r = await WhitelistModel.deleteOne({ _id: c.recordId, status: 'unclaimed' });
        if (r.deletedCount) removed++;
        else keptClaimed++;
      } else {
        const r = await WhitelistModel.updateOne(
          { _id: c.recordId, status: 'unclaimed' },
          { $set: c.before as Record<string, unknown> },
        );
        if (r.matchedCount) restored++;
        else keptClaimed++;
      }
    }
    await ImportJobModel.updateOne(
      { _id: id },
      {
        $set: {
          status: 'rolled_back',
          rollback: { at: new Date(), by: new Types.ObjectId(actorId), removed, restored, keptClaimed },
        },
      },
    );
    await audit.record(
      {
        action: 'import.rolled_back',
        actorId,
        targetType: 'import',
        targetId: id,
        meta: { removed, restored, keptClaimed },
      },
      meta,
    );
    return { removed, restored, keptClaimed };
  }
}
