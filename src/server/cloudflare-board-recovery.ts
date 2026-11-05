import { D1BoardError, type D1BoardDatabase } from './cloudflare-board-store.ts'

/** Private operator step after a reviewed database restore, before reopening access. It does not restore data. */
export async function invalidateD1BoardEpoch(
  database: D1BoardDatabase, expectedEpoch: string, expectedRevision: number, newEpoch: string,
): Promise<{ epoch: string; revision: number }> {
  if ((expectedEpoch !== 'initial' && !/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(expectedEpoch))
    || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0 || !Number.isSafeInteger(expectedRevision + 1)
    || !/^[a-f\d]{8}-[a-f\d]{4}-4[a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i.test(newEpoch)
    || newEpoch.toLowerCase() === expectedEpoch.toLowerCase()) throw new D1BoardError('storage')
  const epoch = newEpoch.toLowerCase()
  const token = crypto.randomUUID()
  const results = await database.batch([database.prepare('UPDATE quotation_board_meta SET epoch = ?, revision = revision + 1, write_token = ? WHERE id = 1 AND epoch = ? AND revision = ?')
    .bind(epoch, token, expectedEpoch, expectedRevision)])
  if (!results[0]?.success || results[0].meta.changes !== 1) throw new D1BoardError('conflict')
  return { epoch, revision: expectedRevision + 1 }
}
