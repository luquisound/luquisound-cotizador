import { createHmac, pbkdf2Sync, randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repository = realpathSync(resolve(dirname(fileURLToPath(import.meta.url)), '..'))
const args = process.argv.slice(2)
if (args.length !== 4 || args[0] !== '--password-file' || args[2] !== '--secrets-output') {
  throw new Error('Use --password-file ABS_PRIVATE_TXT --secrets-output ABS_PRIVATE_JSON.')
}
function outsideRepository(path: string): boolean {
  const difference = relative(repository, path)
  return difference.startsWith('..\\') || difference.startsWith('../') || isAbsolute(difference)
}
function privateInput(value: string | undefined): string {
  if (!value || !isAbsolute(value)) throw new Error('The private password path must be absolute.')
  const input = realpathSync(value)
  if (!outsideRepository(input)) throw new Error('Credentials must stay outside the repository.')
  const info = statSync(input)
  if (!info.isFile() || info.size < 1 || info.size > 4096) throw new Error('Invalid private password file.')
  return input
}
function privateOutput(value: string | undefined): string {
  if (!value || !isAbsolute(value)) throw new Error('Private output paths must be absolute.')
  const requested = resolve(value)
  if (!outsideRepository(requested)) throw new Error('Credentials must stay outside the repository.')
  mkdirSync(dirname(requested), { recursive: true })
  const output = join(realpathSync(dirname(requested)), basename(requested))
  if (!outsideRepository(output)) throw new Error('The private output cannot point into the repository.')
  if (existsSync(output)) throw new Error('Private deployment output already exists. Preserve it and review before retrying.')
  return output
}
const input = privateInput(args[1])
const secretsOutput = privateOutput(args[3])
let password: string
try {
  // A text editor's optional BOM and one final line ending are file framing.
  // Every other character, including leading/trailing spaces, is significant.
  password = new TextDecoder('utf-8', { fatal: true }).decode(readFileSync(input)).replace(/\r?\n$/, '')
} catch { throw new Error('The private password file must contain valid UTF-8.') }
if (Array.from(password).length < 11 || Array.from(password).length > 128
  || Array.from(password).some((character) => character.codePointAt(0)! < 32 || character.codePointAt(0) === 127)) {
  throw new Error('Use one password of 11 to 128 characters without control characters.')
}
const key = randomBytes(32)
const salt = randomBytes(16)
const credential = pbkdf2Sync(password, salt, 600_000, 32, 'sha256').toString('base64url')
const secret = JSON.stringify({
  version: 3, key: key.toString('base64url'), salt: salt.toString('base64url'),
  passwordSignature: createHmac('sha256', key).update(`password:${credential}`).digest('base64url'),
})
writeFileSync(secretsOutput, JSON.stringify({ COTIZADOR_PIN_AUTH_SECRET: secret }), { flag: 'wx', mode: 0o600 })
// Deploy the reviewed Worker and this exact JSON together; preparation changes no remote credential.
console.log(`Private deployment JSON prepared: ${secretsOutput}`)
console.log('Remote access has not changed. Preserve the private input and deployment file until verification.')
