import { z } from 'zod';
import { objectId } from '@campuslink/shared';

export const idParams = z.strictObject({ id: objectId });
