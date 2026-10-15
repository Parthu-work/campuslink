# Data sources (college lists)

A college's student and alumni list is the verification whitelist: a record holds a roll number, name, and optionally branch, graduation year, email, phone and kind (student or alumni). Records do **not** create accounts. People sign up themselves and claim their record during verification.

Admins bring records in from **Admin → Imports**. Every source goes through the same pipeline: read rows → preview (first rows, suggested column mapping) → map columns → optional dry run → background job → report and rollback.

## Built-in sources

| Source        | How it is read                                                                                                                                                          | Limits                                                     |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| CSV upload    | `csv-parse`; UTF-8 (BOM tolerated), comma, semicolon or tab                                                                                                             | 5 MB, 20,000 rows, 500 characters per cell                 |
| XLSX upload   | `read-excel-file`, first sheet; the archive is pre-scanned for zip bombs before parsing                                                                                 | same                                                       |
| Google Sheets | Google's documented CSV export URL. The sheet must be shared "Anyone with the link can view". No scraping and no OAuth (yet).                                           | fetched with the SSRF-safe fetcher, Google hosts only      |
| REST / JSON   | `GET` an HTTPS URL that returns JSON. `recordsPath` (e.g. `data.students`) points at the array. An optional bearer token is used for that one request and never stored. | SSRF-safe fetcher: public IPs only, timeouts and size caps |

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
4. Credentials come from env (per deployment) or are supplied per request and never stored or logged.
5. Throw `SourceError` with a message an admin can act on; the service turns it into a `400`.
6. Add the kind to `importSourceBody` in `packages/shared/src/schemas/people.ts` and the job's `sourceKind` enum, wire it in `ImportsService.previewRemote()`, and add tests using a fake transport (see `apps/api/test/safe-fetch.test.ts`).
