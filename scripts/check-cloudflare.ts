import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const output = mkdtempSync(join(tmpdir(), 'luquisound-worker-check-'))
try {
  const result = spawnSync(process.execPath, [
    join(repository, 'node_modules/wrangler/bin/wrangler.js'),
    'deploy', '--dry-run', '--outdir', output,
  ], {
    cwd: repository, encoding: 'utf8', env: { ...process.env, WRANGLER_SEND_METRICS: 'false' },
  })
  process.stdout.write(result.stdout ?? '')
  process.stderr.write(result.stderr ?? '')
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error('Cloudflare bundle validation failed.')
  const bundle = readFileSync(join(output, 'worker.js'), 'utf8')
  if (/@vercel\/(?:blob|functions|oidc)|from ["']node:/.test(bundle)) {
    throw new Error('The Cloudflare bundle contains a legacy platform dependency.')
  }
  console.log('Cloudflare dry run passed. No resources were created or deployed.')
} finally {
  // Only the exact OS-temporary directory created above is removed.
  rmSync(output, { recursive: true, force: true })
}
