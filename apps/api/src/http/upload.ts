import multer from 'multer';
import type { RequestHandler } from 'express';
import { ErrorCode } from '@campuslink/shared';
import { AppError } from '../lib/errors.js';
import type { UploadSpec } from './registry.js';

/** Memory upload, one file, tight limits. Content is sniffed later; the client's mimetype is ignored. */
export function uploader(spec: UploadSpec): RequestHandler {
  const mw = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: spec.maxBytes, files: 1, fields: 10, fieldSize: 4096, parts: 12, headerPairs: 50 },
  }).single(spec.field);
  return (req, res, next) => {
    if (!req.is('multipart/form-data'))
      return next(new AppError(415, ErrorCode.VALIDATION_FAILED, 'Send the file as multipart/form-data'));
    mw(req, res, (err: unknown) => {
      if (!err) return next();
      const code = (err as { code?: string }).code;
      if (code === 'LIMIT_FILE_SIZE')
        return next(
          new AppError(
            413,
            ErrorCode.VALIDATION_FAILED,
            `File is too large (max ${Math.round(spec.maxBytes / 1048576)} MB)`,
          ),
        );
      next(new AppError(400, ErrorCode.VALIDATION_FAILED, 'Could not read the upload'));
    });
  };
}
