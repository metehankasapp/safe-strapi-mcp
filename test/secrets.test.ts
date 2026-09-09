import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { writeFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import test from 'node:test';
import { secretFromEnvironment } from '../src/secrets.js';

test('secret values can be loaded from Docker/Kubernetes secret files', () => {
  const name = `SAFE_STRAPI_TEST_${randomUUID().replaceAll('-', '_')}`;
  const file = resolve(tmpdir(), `safe-strapi-secret-${randomUUID()}`);
  writeFileSync(file, '  file-secret-value\n', { mode: 0o600 });
  process.env[`${name}_FILE`] = file;
  try {
    assert.equal(secretFromEnvironment(name), 'file-secret-value');
    process.env[name] = 'direct-value';
    assert.equal(secretFromEnvironment(name), 'direct-value');
  } finally {
    delete process.env[name];
    delete process.env[`${name}_FILE`];
    unlinkSync(file);
  }
});
