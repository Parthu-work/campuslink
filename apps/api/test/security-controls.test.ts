import { beforeAll, describe, expect, it } from 'vitest';
import { makeTenant, type TestTenant } from './helpers.js';
import { runInTenant } from '../src/lib/context.js';
import { MemoryStorage } from '../src/lib/storage.js';
import { AuditModel } from '../src/modules/audit/audit.model.js';
import { FileModel } from '../src/modules/files/file.model.js';
import { FilesService, type MalwareScanner } from '../src/modules/files/files.service.js';

/** Controls from the Phase 8 security review that had no direct test before. */
let T: TestTenant;
beforeAll(async () => {
  T = await makeTenant('securityctl');
});

describe('the audit log is append-only', () => {
  it('refuses every update and delete path, and re-saving an entry', async () => {
    await runInTenant(T._id, async () => {
      const entry = await AuditModel.create({ action: 'test.created' });
      const id = entry._id;
      const refused = [
        () => AuditModel.updateOne({ _id: id }, { $set: { action: 'tampered' } }),
        () => AuditModel.updateMany({}, { $set: { action: 'tampered' } }),
        () => AuditModel.findOneAndUpdate({ _id: id }, { $set: { action: 'tampered' } }),
        () => AuditModel.replaceOne({ _id: id }, { action: 'tampered' }),
        () => AuditModel.findOneAndReplace({ _id: id }, { action: 'tampered' }),
        () => AuditModel.deleteOne({ _id: id }),
        () => AuditModel.deleteMany({}),
        () => AuditModel.findOneAndDelete({ _id: id }),
        () => entry.deleteOne(),
        async () => {
          entry.action = 'tampered';
          await entry.save();
        },
      ];
      for (const attempt of refused) await expect(attempt()).rejects.toThrow(/append-only/);
      expect((await AuditModel.findById(id).lean())?.action).toBe('test.created');
    });
  });
});

describe('the antivirus hook', () => {
  it('refuses a file the scanner flags, before anything is stored', async () => {
    const storage = new MemoryStorage();
    const flagged: MalwareScanner = { scan: async () => 'infected' };
    const files = new FilesService(storage, flagged);
    await runInTenant(T._id, async () => {
      const before = await FileModel.countDocuments({});
      await expect(
        files.storeImportSource('64b7f0000000000000000001', Buffer.from('roll,name\n1,Demo'), 'text/csv'),
      ).rejects.toThrow(/malware scanner/);
      expect(await FileModel.countDocuments({})).toBe(before);
    });
  });

  it('stores the file when the scanner reports it clean', async () => {
    const files = new FilesService(new MemoryStorage(), { scan: async () => 'clean' });
    await runInTenant(T._id, async () => {
      const f = await files.storeImportSource(
        '64b7f0000000000000000001',
        Buffer.from('roll,name'),
        'text/csv',
      );
      expect(f).toBeTruthy();
    });
  });
});
