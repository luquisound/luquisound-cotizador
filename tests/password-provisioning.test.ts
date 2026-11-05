import assert from 'node:assert/strict'
import { createHmac, pbkdf2Sync } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, relative } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const script = fileURLToPath(new URL('../scripts/provision-pin-auth.ts', import.meta.url))
function removeTemporaryDirectory(directory: string): void {
  const target = realpathSync(directory)
  assert.equal(relative(realpathSync(tmpdir()), dirname(target)), '')
  assert.ok(basename(target).startsWith('luquisound-password-'))
  rmSync(target, { recursive: true, force: true })
}
const run = (input: string, secretsOutput: string) => spawnSync(process.execPath, [
  '--experimental-strip-types', script, '--password-file', input, '--secrets-output', secretsOutput,
], { encoding: 'utf8', timeout: 10000 })

test('private preparation derives a salted chosen-password verifier without printing credentials or replacing files', (context) => {
  const directory = mkdtempSync(join(tmpdir(), 'luquisound-password-provision-'))
  context.after(() => removeTemporaryDirectory(directory))
  const input = join(directory, 'access.txt')
  const secrets = join(directory, 'deploy.json')
  const password = 'Synthetic11'
  const original = `\uFEFF${password}\r\n`
  writeFileSync(input, original)
  const first = run(input, secrets)
  assert.equal(first.status, 0, first.stderr)
  const privateJson = readFileSync(secrets, 'utf8')
  const values = JSON.parse(privateJson) as Record<string, string>
  assert.deepEqual(Object.keys(values), ['COTIZADOR_PIN_AUTH_SECRET'])
  const auth = JSON.parse(values.COTIZADOR_PIN_AUTH_SECRET!) as { version: number; key: string; salt: string; passwordSignature: string }
  assert.equal(auth.version, 3)
  assert.equal(Buffer.from(auth.key, 'base64url').length, 32)
  assert.equal(Buffer.from(auth.salt, 'base64url').length, 16)
  const credential = pbkdf2Sync(password, Buffer.from(auth.salt, 'base64url'), 600_000, 32, 'sha256').toString('base64url')
  assert.equal(auth.passwordSignature, createHmac('sha256', Buffer.from(auth.key, 'base64url')).update(`password:${credential}`).digest('base64url'))
  for (const value of [password, credential, auth.key, auth.passwordSignature]) {
    assert.equal(first.stdout.includes(value), false)
    assert.equal(first.stderr.includes(value), false)
  }
  assert.equal(privateJson.includes(password), false)
  assert.equal(privateJson.includes(credential), false)
  assert.equal(readFileSync(input, 'utf8'), original)
  const second = run(input, secrets)
  assert.notEqual(second.status, 0)
  assert.equal(readFileSync(input, 'utf8'), original)
  assert.equal(readFileSync(secrets, 'utf8'), privateJson)
  const next = join(directory, 'next.json')
  assert.equal(run(input, next).status, 0)
  const rotated = JSON.parse(JSON.parse(readFileSync(next, 'utf8')).COTIZADOR_PIN_AUTH_SECRET) as typeof auth
  assert.notEqual(rotated.key, auth.key)
  assert.notEqual(rotated.salt, auth.salt)
  assert.notEqual(rotated.passwordSignature, auth.passwordSignature)
})

test('private preparation preserves significant spaces and exact Unicode without normalization', (context) => {
  const directory = mkdtempSync(join(tmpdir(), 'luquisound-password-exact-'))
  context.after(() => removeTemporaryDirectory(directory))
  const input = join(directory, 'access.txt')
  const output = join(directory, 'deploy.json')
  const password = ' e\u0301synthetic password '
  writeFileSync(input, password)
  assert.equal(run(input, output).status, 0)
  const auth = JSON.parse(JSON.parse(readFileSync(output, 'utf8')).COTIZADOR_PIN_AUTH_SECRET) as { key: string; salt: string; passwordSignature: string }
  const expected = pbkdf2Sync(password, Buffer.from(auth.salt, 'base64url'), 600_000, 32, 'sha256').toString('base64url')
  assert.equal(auth.passwordSignature, createHmac('sha256', Buffer.from(auth.key, 'base64url')).update(`password:${expected}`).digest('base64url'))
})

test('private preparation rejects invalid text and password bounds without copying the private input into errors', (context) => {
  const directory = mkdtempSync(join(tmpdir(), 'luquisound-password-invalid-'))
  context.after(() => removeTemporaryDirectory(directory))
  const input = join(directory, 'access.txt')
  const output = join(directory, 'deploy.json')
  for (const content of ['short', 'A'.repeat(129), 'Synthetic11\n\n', 'Synthetic\t11', Buffer.from([0xff, 0xfe, 0xfd])]) {
    writeFileSync(input, content)
    const result = run(input, output)
    assert.notEqual(result.status, 0)
    assert.equal(existsSync(output), false)
    if (typeof content === 'string') assert.equal(result.stderr.includes(content), false)
  }
})

test('private preparation refuses output or input paths inside the source repository before writing credentials', (context) => {
  const directory = mkdtempSync(join(tmpdir(), 'luquisound-password-path-'))
  context.after(() => removeTemporaryDirectory(directory))
  const input = join(directory, 'access.txt')
  writeFileSync(input, 'Synthetic11')
  const sourcePath = fileURLToPath(new URL('../must-not-create-credential.txt', import.meta.url))
  const secrets = join(directory, 'deploy.json')
  assert.equal(existsSync(sourcePath), false)
  assert.notEqual(run(input, sourcePath).status, 0)
  assert.equal(existsSync(sourcePath), false)
  assert.notEqual(run(fileURLToPath(new URL('../package.json', import.meta.url)), secrets).status, 0)
  assert.equal(existsSync(secrets), false)
})
