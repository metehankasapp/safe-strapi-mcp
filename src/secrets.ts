import { readFileSync } from 'node:fs';
import { AppError } from './errors.js';

export function secretFromEnvironment(name: string): string | undefined {
  const direct = process.env[name]?.trim();
  if (direct) return direct;
  const filePath = process.env[`${name}_FILE`]?.trim();
  if (!filePath) return undefined;
  try {
    const value = readFileSync(filePath, 'utf8').trim();
    if (!value) throw new Error('Secret file is empty');
    return value;
  } catch (error) {
    throw new AppError('CONFIG_ERROR', `Unable to read secret file for ${name}`, {
      cause: error instanceof Error ? error.message : String(error),
    }, 500);
  }
}
