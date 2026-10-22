#!/usr/bin/env node
/**
 * Writes src/styles/palette.css from the palette generator in @campuslink/shared (build it first).
 * The default college hue plus the fixed status, role and chart colours; src/styles/palette.test.ts
 * fails when the file is out of date.
 */
import { writeFileSync } from 'node:fs';
import { defaultPaletteCss } from '@campuslink/shared';

const file = new URL('../src/styles/palette.css', import.meta.url);
writeFileSync(file, defaultPaletteCss());
console.log(`Wrote ${file.pathname}`);
