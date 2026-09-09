import { randomBytes } from 'node:crypto';
import { chmod, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';

const apiKey = randomBytes(32).toString('hex');
const putSecret = (name, value) => {
  const result = spawnSync('npx', ['wrangler', 'secret', 'put', name], {
    input: `${value}\n`,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  if (result.status !== 0) throw new Error(`Unable to provision ${name}: ${result.stderr}`);
};

putSecret('MCP_API_KEY', apiKey);
putSecret('PROJECTS_JSON', JSON.stringify({ projects: {} }));
const localPath = new URL('../.dev.vars.generated', import.meta.url);
await writeFile(localPath, `MCP_API_KEY=${apiKey}\nPROJECTS_JSON='{"projects":{}}'\n`, { mode: 0o600 });
await chmod(localPath, 0o600);
process.stdout.write('Worker secrets provisioned; local credentials saved with mode 0600.\n');
