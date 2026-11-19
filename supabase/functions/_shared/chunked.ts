export type ChunkQueryResult<T, E> =
  | { data: T[]; error: null }
  | { data: null; error: E };

export interface SelectInChunksOptions {
  size?: number;
  concurrency?: number;
}

export async function selectInChunks<T, V, E>(
  values: readonly V[],
  run: (chunk: V[]) => PromiseLike<ChunkQueryResult<T, E>>,
  { size = 100, concurrency = 4 }: SelectInChunksOptions = {},
): Promise<ChunkQueryResult<T, E>> {
  if (!Number.isSafeInteger(size) || size <= 0) {
    throw new RangeError("Chunk size must be a positive integer.");
  }
  if (!Number.isSafeInteger(concurrency) || concurrency <= 0) {
    throw new RangeError("Concurrency must be a positive integer.");
  }

  const uniqueValues = [...new Set(values)];
  if (uniqueValues.length === 0) {
    return { data: [], error: null };
  }

  const chunks: V[][] = [];
  for (let index = 0; index < uniqueValues.length; index += size) {
    chunks.push(uniqueValues.slice(index, index + size));
  }

  const rowsByChunk: T[][] = new Array(chunks.length);
  let nextChunk = 0;
  let failed = false;
  let firstError!: E;

  async function worker(): Promise<void> {
    while (!failed) {
      const index = nextChunk++;
      if (index >= chunks.length) return;

      const result = await run(chunks[index]);
      if (result.data === null) {
        if (!failed) {
          failed = true;
          firstError = result.error;
        }
        return;
      }
      rowsByChunk[index] = result.data;
    }
  }

  const workerCount = Math.min(concurrency, chunks.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  if (failed) {
    return { data: null, error: firstError };
  }
  return { data: rowsByChunk.flat(), error: null };
}
