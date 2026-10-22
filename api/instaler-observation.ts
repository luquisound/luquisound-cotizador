import { timingSafeEqual } from 'node:crypto'
import { validateInstalerSourceBinding, type InstalerSourceBinding } from '../src/server/instaler-source.ts'
import {
  decodeInstalerObservationSource, readInstalerObservationUpload, InstalerUploadError,
  type InstalerObservationUpload,
} from '../src/server/instaler-upload.ts'
import { readInstalerXlsx } from '../src/server/instaler-xlsx.ts'
import {
  InstalerObservationError, makeObservationSnapshot, runInstalerObservation,
  type ObservationSnapshot,
} from '../src/server/instaler-observation.ts'
import {
  createInstalerObservationStore, type InstalerObservationStore,
} from '../src/server/instaler-observation-store.ts'
import { createInstalerCatalogStore, type InstalerCatalogStore } from '../src/server/instaler-catalog-store.ts'
import { publishInstalerCatalog, InstalerPublicationError } from '../src/server/instaler-publication.ts'

export interface ObservationServerConfig {
  environment?: string
  mode?: string
  ingestSecret?: string
  blobToken?: string
  expectedEmail?: string
  fileId?: string
  catalogUrl?: string
  publicationMode?: string
  catalogToken?: string
}

interface ObservationDependencies {
  store?: InstalerObservationStore
  read?: (upload: InstalerObservationUpload) => Promise<ObservationSnapshot>
  now?: () => Date
  log?: (event: Record<string, unknown>) => void
  publicationStore?: InstalerCatalogStore
}

function response(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status, headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'private, no-store', 'CDN-Cache-Control': 'no-store',
      'Vercel-CDN-Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
      ...(status === 405 ? { Allow: 'POST' } : {}),
    },
  })
}

async function readSnapshot(upload: InstalerObservationUpload): Promise<ObservationSnapshot> {
  const source = decodeInstalerObservationSource(upload)
  const extraction = await readInstalerXlsx(source.bytes, source.metadata.name)
  return makeObservationSnapshot({
    source: { ...extraction.source, version: source.metadata.version },
    headerRow: extraction.headerRow, headers: extraction.headers,
    rows: extraction.rows.map(({ row, values, unit, presentation }) => ({
      row, values, ...(unit === undefined ? {} : { unit }), ...(presentation === undefined ? {} : { presentation }),
    })),
  }, source.metadata, source.readAt)
}

/** Observation stays read-only to the catalogue; a separately enabled publisher consumes its committed reading. */
export async function serveInstalerObservation(
  request: Request, config: ObservationServerConfig, dependencies: ObservationDependencies = {},
): Promise<Response> {
  if (config.environment !== 'production' || !config.mode || config.mode === 'disabled') return response({ error: 'disabled' }, 404)
  if (config.mode !== 'observe') return response({ error: 'configuration' }, 503)
  if (request.method !== 'POST') return response({ error: 'method' }, 405)
  if (!config.ingestSecret || !/^[a-zA-Z0-9_-]{32,256}$/.test(config.ingestSecret)) return response({ error: 'configuration' }, 503)
  const supplied = Buffer.from(request.headers.get('authorization') ?? '')
  const expected = Buffer.from(`Bearer ${config.ingestSecret}`)
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return response({ error: 'unauthorized' }, 401)
  if (new URL(request.url).search) return response({ error: 'parameters-not-supported' }, 400)
  if (!config.expectedEmail || !config.fileId || !config.blobToken) return response({ error: 'configuration' }, 503)
  const binding: InstalerSourceBinding = { expectedEmail: config.expectedEmail, fileId: config.fileId }
  try {
    validateInstalerSourceBinding(binding)
    const now = dependencies.now ?? (() => new Date())
    const upload = await readInstalerObservationUpload(request, binding, now())
    const store = dependencies.store ?? createInstalerObservationStore(config.blobToken, config.catalogUrl)
    let snapshot: ObservationSnapshot | undefined
    const result = await runInstalerObservation(binding, store, async () => {
      snapshot = await (dependencies.read ?? readSnapshot)(upload)
      return snapshot
    }, now)
    dependencies.log?.({ event: 'instaler-observation', ...result })
    if (snapshot && (result.status === 'baseline' || result.status === 'changed' || result.status === 'unchanged')
      && config.publicationMode && config.publicationMode !== 'disabled') {
      try {
        if (config.publicationMode !== 'publish' || !config.catalogToken || !config.catalogUrl) {
          throw new Error('Invalid publication configuration')
        }
        const catalogStore = dependencies.publicationStore ?? createInstalerCatalogStore(config.catalogToken, config.catalogUrl)
        const publication = await publishInstalerCatalog(snapshot, catalogStore, now())
        dependencies.log?.({ event: 'instaler-catalog-publication', ...publication })
        return response({ ...result, catalogPublication: publication })
      } catch (error) {
        const code = error instanceof InstalerPublicationError ? error.code : 'configuration'
        dependencies.log?.({ event: 'instaler-catalog-publication', status: 'failed', error: code })
        // The source attempt is already safely recorded. Do not retry Drive or mislabel it as a failed read.
        return response({ ...result, catalogPublication: { status: 'failed', error: code } }, 503)
      }
    }
    return response(result, result.status === 'failed' ? 502 : 200)
  } catch (error) {
    if (error instanceof InstalerUploadError) {
      const status = error.code === 'payload-too-large' ? 413 : error.code === 'media-type' ? 415
        : error.code === 'body-timeout' ? 408 : 400
      return response({ mode: 'observe', publicationAllowed: false, supplierFreshnessEstablished: false, error: error.code }, status)
    }
    const code = error instanceof InstalerObservationError ? error.code : 'configuration'
    dependencies.log?.({ event: 'instaler-observation', status: 'failed', error: code })
    return response({ mode: 'observe', publicationAllowed: false, supplierFreshnessEstablished: false, error: code }, code === 'conflict' ? 409 : 503)
  }
}

export default {
  fetch(request: Request): Promise<Response> {
    return serveInstalerObservation(request, {
      environment: process.env.VERCEL_ENV, mode: process.env.INSTALER_OBSERVATION_MODE,
      ingestSecret: process.env.INSTALER_OBSERVATION_INGEST_SECRET,
      blobToken: process.env.INSTALER_OBSERVATION_BLOB_READ_WRITE_TOKEN,
      expectedEmail: process.env.INSTALER_GOOGLE_EXPECTED_EMAIL,
      fileId: process.env.INSTALER_DRIVE_FILE_ID, catalogUrl: process.env.CATALOG_BLOB_URL,
      publicationMode: process.env.INSTALER_CATALOG_MODE, catalogToken: process.env.BLOB_READ_WRITE_TOKEN,
    }, { log: (event) => console.info(JSON.stringify(event)) })
  },
}
