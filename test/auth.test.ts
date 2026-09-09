import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import test from 'node:test';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { Authenticator, canAccessProject, requireScope, runAsPrincipal } from '../src/auth.js';

test('legacy API key authentication uses constant-length validated credentials', async () => {
  const key = 'a'.repeat(32);
  const auth = new Authenticator({ apiKey: key });
  assert.equal((await auth.authenticate(`Bearer ${key}`)).authentication, 'api-key');
  await assert.rejects(auth.authenticate('Bearer wrong'), (error: any) => error?.code === 'UNAUTHORIZED');
});

test('OIDC verifies issuer/audience and enforces scope and project claims', async () => {
  const { privateKey, publicKey } = await generateKeyPair('RS256');
  const jwk = { ...await exportJWK(publicKey), kid: 'test-key', use: 'sig', alg: 'RS256' };
  const server = createServer((_request, response) => response.end(JSON.stringify({ keys: [jwk] })));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  try {
    const issuer = 'https://auth.example.com/';
    const audience = 'https://mcp.example.com/mcp';
    const token = await new SignJWT({ scope: 'mcp:read', projects: ['example-site'], tenant_id: 'example-tenant' })
      .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
      .setSubject('user-1').setIssuer(issuer).setAudience(audience).setIssuedAt().setExpirationTime('5m').sign(privateKey);
    const auth = new Authenticator({ issuer, audience, jwksUri: `http://127.0.0.1:${port}/jwks` });
    const principal = await auth.authenticate(`Bearer ${token}`);
    assert.equal(principal.subject, 'user-1');
    assert.equal(principal.tenant, 'example-tenant');
    runAsPrincipal(principal, () => {
      requireScope('mcp:read');
      assert.equal(canAccessProject('example-site'), true);
      assert.equal(canAccessProject('another-project'), false);
      assert.throws(() => requireScope('mcp:write'), (error: any) => error?.code === 'INSUFFICIENT_SCOPE');
    });
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
