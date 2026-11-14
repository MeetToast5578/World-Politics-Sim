import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Baseline } from '../engine/types';

export function loadBaseline(): Baseline {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  return JSON.parse(fs.readFileSync(path.join(root, 'public/data/baseline.json'), 'utf8'));
}
