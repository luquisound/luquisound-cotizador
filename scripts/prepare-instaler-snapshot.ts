import { createHash } from 'node:crypto'
import { existsSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, isAbsolute, relative, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { CATALOG_IMPORT_MAX_BYTES, parseCatalogImport } from '../src/features/quotation/catalog.ts'
import { prepareInstalerSnapshot } from '../src/server/instaler-snapshot.ts'
import { compareInstalerSnapshot } from '../src/server/instaler-review.ts'

const REPOSITORY_ROOT = realpathSync(resolve(dirname(fileURLToPath(import.meta.url)), '..'))
const MAX_XLSX_BYTES = 8 * 1024 * 1024
const MAX_EXTRACTION_BYTES = 16 * 1024 * 1024
const MAX_REVIEW_BYTES = 32 * 1024 * 1024

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('Invalid extraction.')
  return value as Record<string, unknown>
}

export function prepareLocalInstalerReview(extraction: unknown, baselineText: string, baselineName: string) {
  const input = record(extraction)
  const source = record(input.source)
  const coverage = record(input.coverage)
  if (input.format !== 'luquisound.instaler-xlsx-extraction' || input.version !== 1
    || input.sheet !== 'Precios' || coverage.complete !== false
    || typeof source.byteLength !== 'number' || !Number.isSafeInteger(source.byteLength)
    || source.byteLength < 1 || source.byteLength > MAX_XLSX_BYTES
    || typeof source.checksum !== 'string' || !/^[a-f0-9]{64}$/.test(source.checksum)) {
    throw new Error('Invalid extraction.')
  }
  const snapshot = prepareInstalerSnapshot(input)
  const current = parseCatalogImport(baselineText)
  const comparison = compareInstalerSnapshot(snapshot, current)
  return {
    format: 'luquisound.instaler-snapshot-review', version: 1,
    reviewRequired: true, publicationAllowed: false,
    baseline: {
      document: baselineName,
      checksum: createHash('sha256').update(baselineText).digest('hex'),
      kind: 'local-file', verifiedLive: false,
    },
    coverage: { complete: false, scope: 'precios-only', kits: 'pending', units: 'pending' },
    snapshot, comparison,
    // This is a private review report: preserve raw cells/formulas without executing them.
    extraction: input,
  }
}

export function writePrivateInstalerReview(path: string, report: unknown): void {
  const output = resolve(realpathSync(dirname(resolve(path))), basename(path))
  const location = relative(REPOSITORY_ROOT, output)
  if (!location || (!location.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`)
    && location !== '..' && !isAbsolute(location))) {
    throw new Error('Private reports must remain outside the repository.')
  }
  let ancestor = dirname(output)
  while (true) {
    if (existsSync(resolve(ancestor, '.git'))) throw new Error('Private reports must remain outside Git worktrees.')
    const parent = dirname(ancestor)
    if (parent === ancestor) break
    ancestor = parent
  }
  const body = JSON.stringify(report, (_key: string, value: unknown) => {
    if (typeof value === 'number' && !Number.isFinite(value)) throw new Error('Invalid numeric review evidence.')
    return value
  }, 2) + '\n'
  if (Buffer.byteLength(body) > MAX_REVIEW_BYTES) throw new Error('Review report limit exceeded.')
  // Exclusive creation prevents overwriting a source, baseline or another review.
  writeFileSync(output, body, { encoding: 'utf8', flag: 'wx', mode: 0o600 })
}

function argumentsForPreparation(args: string[]): Map<string, string> {
  const options = new Map<string, string>()
  const allowed = new Set(['--xlsx', '--current-catalog', '--output', '--python'])
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index]
    const value = args[index + 1]
    if (!allowed.has(key) || options.has(key) || !value || value.startsWith('--')) throw new Error('Invalid preparation arguments.')
    options.set(key, value)
  }
  if (!options.has('--xlsx') || !options.has('--current-catalog') || !options.has('--output')) {
    throw new Error('Required: --xlsx <file> --current-catalog <file> --output <new private file> [--python <executable>].')
  }
  return options
}

function boundedText(path: string, limit: number): string {
  const info = statSync(path)
  if (!info.isFile() || info.size < 1 || info.size > limit) throw new Error('Invalid input file size.')
  const bytes = readFileSync(path)
  if (bytes.byteLength > limit) throw new Error('Input file size changed.')
  return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes)
}

function run(): void {
  const options = argumentsForPreparation(process.argv.slice(2))
  const sourcePath = resolve(options.get('--xlsx')!)
  const sourceInfo = statSync(sourcePath)
  if (!sourceInfo.isFile() || sourceInfo.size < 1 || sourceInfo.size > MAX_XLSX_BYTES) throw new Error('Invalid XLSX size.')
  const python = options.get('--python') ?? (process.platform === 'win32' ? 'python' : 'python3')
  const extracted = spawnSync(python, [resolve(REPOSITORY_ROOT, 'scripts/read-instaler-xlsx.py'), sourcePath], {
    encoding: 'utf8', shell: false, windowsHide: true, timeout: 20000, maxBuffer: MAX_EXTRACTION_BYTES,
  })
  if (extracted.error || extracted.status !== 0 || Buffer.byteLength(extracted.stdout) > MAX_EXTRACTION_BYTES) {
    throw new Error('Local XLSX extraction failed; retain the previous catalogue.')
  }
  const baselinePath = resolve(options.get('--current-catalog')!)
  const baselineText = boundedText(baselinePath, CATALOG_IMPORT_MAX_BYTES)
  const report = prepareLocalInstalerReview(JSON.parse(extracted.stdout) as unknown, baselineText, basename(baselinePath))
  writePrivateInstalerReview(options.get('--output')!, report)
  const codes: Record<string, number> = {}
  for (const { code } of report.snapshot.issues) codes[code] = (codes[code] ?? 0) + 1
  process.stdout.write(JSON.stringify({
    written: true, reviewRequired: true, publicationAllowed: false,
    sourceChecksum: report.snapshot.source.checksum,
    items: report.snapshot.items.length, sections: report.snapshot.sections.length,
    issueCounts: codes, comparison: report.comparison.summary,
  }) + '\n')
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { run() } catch {
    process.stderr.write('Snapshot preparation failed. Check the local inputs and private output location; no catalogue was published or changed.\n')
    process.exitCode = 1
  }
}
