# Data sources (college lists)

A college's student and alumni list is the verification whitelist: a record holds a roll number, name, and optionally branch, graduation year, email, phone and kind (student or alumni). Records do **not** create accounts. People sign up themselves and claim their record during verification.

Admins bring records in from **Admin → Imports**. Every source goes through the same pipeline: read rows → preview (first rows, suggested column mapping) → map columns → optional dry run → background job → report and rollback.

## Built-in sources

| Source        | How it is read                                                                                                                                                                                                 | Limits                                                     |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| CSV upload    | `csv-parse`; UTF-8 (BOM tolerated), comma, semicolon or tab                                                                                                                                                    | 5 MB, 20,000 rows, 500 characters per cell                 |
| XLSX upload   | `read-excel-file`, first sheet; the archive is pre-scanned for zip bombs before parsing                                                                                                                        | same                                                       |
| Google Sheets | Google's documented CSV export URL. The sheet must be shared "Anyone with the link can view". No scraping and no OAuth (yet).                                                                                  | fetched with the SSRF-safe fetcher, Google hosts only      |
| REST / JSON   | `GET` an HTTPS URL that returns JSON. `recordsPath` (e.g. `data.students`) points at the array. An optional bearer token is used for that one request and never stored (a scheduled sync keeps it, encrypted). | SSRF-safe fetcher: public IPs only, timeouts and size caps |

Uploaded source files are stored with purpose `import_source`, are never served back, and are deleted as soon as the import runs (at most 24 hours later if it never runs).

## Fields

| Field        | Required | Notes                                                                                                |
| ------------ | :------: | ---------------------------------------------------------------------------------------------------- |
| `rollNumber` |    ✅    | Upper-cased. Unique per college; it is the key for re-imports.                                       |
| `name`       |    ✅    |                                                                                                      |
| `branch`     |          | Common spellings are normalised (`Computer Science and Engineering` → `CSE`).                        |
| `gradYear`   |          | Needed for alumni: they verify with roll number **and** graduation year.                             |
| `email`      |          | Where the verification code goes. Stored encrypted with a blind index.                               |
| `phone`      |          | Indian mobiles normalised to `+91…`. Encrypted. SMS is disabled locally (no free provider).          |
| `kind`       |          | `student` or `alumni`. Without it, kind is derived from the graduation year, or forced by the admin. |

Column names are suggested from common headers (`Hall Ticket No`, `Candidate Name`, `Year of Passing`, …). Try `docs/samples/sample-students.csv`: 6 valid rows plus an invalid email, a missing roll number and a duplicate.

## Job behaviour

- **Idempotent:** re-importing the same list reports rows as unchanged; changed rows update the record.
- **Claimed records are never overwritten** (`skippedClaimed`): once a person has verified, the college corrects their record by hand.
- **Row errors** list the row, column and problem, never the cell value. The downloadable report is guarded against CSV formula injection.
- **Rollback** of a completed import restores the previous version of updated records, removes created ones, and keeps any that were claimed in the meantime.
- Jobs run on BullMQ inside the college's tenant context; progress is polled by the admin screen.

## Scheduled sync (prompt 2, G9)

A Google Sheet or REST source can be read again on a schedule. After a completed (not dry-run) roster import from such a source, **Admin → Imports** offers "Keep this list in sync": daily, or weekly on a chosen day, from 02:00 India time. Each run reuses that import's column mapping and goes through the same pipeline (job, report, rollback):

- **No change**: nothing happens.
- **5% of the rows or fewer change**: it applies as an ordinary import.
- **More than 5%**: it waits. Admins get a notification and see the counts (new, updated, unchanged, kept as members verified them, rows with problems) and up to 50 roll numbers with the fields that change, never the values. Apply applies exactly those rows (stored for up to 7 days); Discard throws them away. A new run replaces a waiting one.
- **A source that fails** (unreachable, access removed, a mapped column renamed) is recorded with its reason; the next run tries again.

Records are never deleted by a sync: someone missing from the source stays on the list (remove them by hand, or roll an import back). A REST source's token is kept encrypted (it is rotated with the field key).

### From a college ERP

Most college ERPs (admission, fee and academic systems) can export the student list as Excel or CSV, and some offer a report API. Two ways to keep CampusLink in step:

1. **Through a Google Sheet** (works with any ERP):
   1. Export the student list from the ERP with the same columns every time (roll number, name, branch, year of passing, email, mobile, and the guardian's mobile for students under 18).
   2. Keep one Google Sheet for it and replace its contents with each export (File › Import › Replace current sheet). Do not rename or reorder the header row.
   3. Share the sheet as "Anyone with the link can view", import it once in Admin → Imports (Google Sheets), check the report, and choose "Keep this list in sync".
2. **Through the ERP's API**, if it has one returning JSON: use REST / JSON with the report's HTTPS URL, the path to the list of records, and a read-only token created for CampusLink alone. Revoke that token in the ERP to stop access at any time.

Either way, the first sync after setting it up usually changes little (the list was just imported); a large change later (a new batch, a renamed column) waits for an admin.

## Adding an ERP or LMS adapter

Implement `DataSourceAdapter` (`apps/api/src/modules/imports/adapters/types.ts`):

```ts
export interface DataSourceAdapter<Input> {
  readonly kind: 'csv' | 'xlsx' | 'gsheet' | 'rest';
  read(input: Input): Promise<SourceRows>; // { headers: string[]; rows: Record<string, string>[] }
}
```

1. Put the adapter in `modules/imports/adapters/<name>.ts`. Build the table with `normaliseTable()` so header de-duplication, row and cell caps apply.
2. Make **every** network call through the injected `Fetcher` (`lib/safe-fetch.ts`), with `allowHosts` set to the vendor's hosts. Never call `fetch` directly.
3. Use the vendor's **official API** and respect its terms. Do not scrape portals.
4. Credentials come from env (per deployment) or are supplied per request and never logged; only a scheduled sync stores one, encrypted with the field cipher.
5. Throw `SourceError` with a message an admin can act on; the service turns it into a `400`.
6. Add the kind to `importSourceBody` in `packages/shared/src/schemas/people.ts` and the job's `sourceKind` enum, wire it in `ImportsService.previewRemote()`, and add tests using a fake transport (see `apps/api/test/safe-fetch.test.ts`).
