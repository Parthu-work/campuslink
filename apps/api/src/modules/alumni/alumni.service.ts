import {
  SMALL_CELL,
  profileBody,
  suppress,
  type BatchView,
  type Branch,
  type LinkedinPreview,
  type linkedinApplyBody,
} from '@campuslink/shared';
import type { z } from 'zod';
import type { AuthState } from '../../types.js';
import { badRequest } from '../../lib/errors.js';
import { noTrack, type Track } from '../../lib/product-events.js';
import type { FilesService } from '../files/files.service.js';
import type { ProfilesService } from '../profiles/profiles.service.js';
import { LinkedinFileError, parseLinkedin } from './linkedin.js';

export interface AlumniDeps {
  profiles: ProfilesService;
  files: FilesService;
  /** Reunions: upcoming meetups for the batch (events). */
  reunions: (
    gradYear: number,
    branch: string,
  ) => Promise<{ id: string; title: string; startsAt: string; kind: string }[]>;
  /** People on the college's list for the batch who have not joined yet (the roster). */
  notJoined: (gradYear: number, branch: string) => Promise<number>;
}

/** Most skills a profile keeps (the profile schema's own limit). */
const PROFILE_SKILLS_MAX = 20;

/**
 * LinkedIn import and batch pages (prompt 2, G6). The import reads the member's own export in
 * memory (scanned, never stored) into a preview; only what they confirm (current company and role,
 * skills) is written, through the profile's own validation. Education is shown to check, not kept:
 * branch and batch come from the college's record.
 */
export class AlumniService {
  track: Track = noTrack;
  constructor(private readonly d: AlumniDeps) {}

  async linkedinPreview(viewer: AuthState, file: Buffer | undefined): Promise<LinkedinPreview> {
    if (!file?.length) throw badRequest('Choose the ZIP or CSV LinkedIn sent you');
    await this.d.files.scanOnly(file);
    const own = await this.d.profiles.mine(viewer);
    try {
      return parseLinkedin(file, own.profile.fields.skills ?? []);
    } catch (e) {
      if (e instanceof LinkedinFileError) throw badRequest(e.message);
      throw e;
    }
  }

  async linkedinApply(viewer: AuthState, body: z.output<typeof linkedinApplyBody>) {
    const own = await this.d.profiles.mine(viewer);
    const have = own.profile.fields.skills ?? [];
    const lower = new Set(have.map((s) => s.toLowerCase()));
    const skills = [...have, ...body.skills.filter((s) => !lower.has(s.toLowerCase()))].slice(
      0,
      PROFILE_SKILLS_MAX,
    );
    const parsed = profileBody.safeParse({
      ...(body.company ? { company: body.company.slice(0, 80) } : {}),
      ...(body.jobTitle ? { jobTitle: body.jobTitle.slice(0, 80) } : {}),
      skills,
    });
    if (!parsed.success)
      throw badRequest('Some of the imported details do not fit a profile', parsed.error.issues);
    const out = await this.d.profiles.updateMine(viewer, parsed.data);
    await this.track(viewer.userId, 'linkedin_imported');
    return out;
  }

  /** "Class of 2018, CSE": who is here (visibility respected), where they work, reunions, who is missing. */
  async batch(viewer: AuthState, gradYear: number, branch: Branch): Promise<BatchView> {
    const [page, facts, reunions, notJoined] = await Promise.all([
      this.d.profiles.directory(viewer, { branch, batchFrom: gradYear, batchTo: gradYear, limit: 30 }),
      this.d.profiles.batchFacts(branch, gradYear),
      this.d.reunions(gradYear, branch),
      this.d.notJoined(gradYear, branch),
    ]);
    return {
      gradYear,
      branch,
      members: page.items.map((p) => ({
        userId: p.userId,
        name: p.name,
        avatarFileId: p.avatarFileId,
        headline: p.fields.headline ?? '',
        company: p.fields.company ?? '',
        jobTitle: p.fields.jobTitle ?? '',
      })),
      total: suppress(facts.total),
      // Only companies with enough of the batch to name them without pointing at anyone.
      companies: facts.companies
        .filter((c) => c.n >= SMALL_CELL)
        .map((c) => ({ company: c.company, count: c.n })),
      reunions,
      notJoined: suppress(notJoined),
    };
  }
}
