import type { RequestHandler } from 'express';
import { ErrorCode } from '@campuslink/shared';
import { AppError } from '../lib/errors.js';
import type { BotProtection } from '../lib/bot.js';

/** Route-level bot check (`bot: true` on a spec). A no-op while bot protection is disabled. */
export function botCheck(bot: BotProtection): RequestHandler {
  return async (req, _res, next) => {
    if (!bot.enabled || (await bot.verify(req.get('x-bot-token'), req.ip))) return next();
    next(new AppError(403, ErrorCode.BOT_CHECK_FAILED, 'Please complete the human check and try again'));
  };
}
