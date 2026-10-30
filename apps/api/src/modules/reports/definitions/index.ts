import type { AccreditationReportId } from '@campuslink/shared';
import type { ReportDefinition } from '../report-data.js';
import { internalPlacement } from './internal-placement.js';
import { naacAlumniEngagement } from './naac-alumni-engagement.js';
import { naacExams } from './naac-exams.js';
import { naacHigherEducation } from './naac-higher-education.js';
import { naacPlacement } from './naac-placement.js';
import { nbaSarPlacement } from './nba-sar-placement.js';
import { nirfMedianSalary } from './nirf-median-salary.js';

/** Every report the college can generate (B8), in the order the reports screen lists them. */
export const DEFINITIONS: readonly ReportDefinition[] = [
  internalPlacement,
  nbaSarPlacement,
  naacPlacement,
  naacHigherEducation,
  naacExams,
  naacAlumniEngagement,
  nirfMedianSalary,
];
export const definitionOf = (id: AccreditationReportId) => DEFINITIONS.find((d) => d.id === id);
