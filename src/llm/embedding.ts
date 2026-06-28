/**
 * Local embedding client using all-MiniLM-L6-v2 via @huggingface/transformers.
 * Produces exactly 384-dimensional unit vectors. Model is downloaded once to
 * ~/.cache/huggingface on first use, then cached in memory for the process lifetime.
 */
const EXPECTED_EMBED_DIM = 384;

type EmbedFn = (texts: string[]) => Promise<number[][]>;

let _localPipeline: EmbedFn | null = null;

async function _loadPipeline(): Promise<EmbedFn> {
  const { pipeline } = await import("@huggingface/transformers");
  const extractor = await pipeline(
    "feature-extraction",
    "Xenova/all-MiniLM-L6-v2",
    { revision: "main" }
  );
  return async (inputs: string[]) => {
    const output = await extractor(inputs, {
      pooling: "mean",
      normalize: true,
    }) as { data: Float32Array; dims: number[] };
    const dims = output.dims;
    const batchSize = dims[0];
    const stride = output.data.length / batchSize;
    if (stride !== EXPECTED_EMBED_DIM) {
      throw new Error(
        `Embedding dimension mismatch: expected ${EXPECTED_EMBED_DIM} but ` +
        `model returned ${stride} values per sample (dims=${JSON.stringify(dims)}). ` +
        `Delete ~/.cache/huggingface and re-run to force a fresh download.`
      );
    }
    const result: number[][] = [];
    for (let i = 0; i < batchSize; i++) {
      result.push(Array.from(output.data.slice(i * stride, (i + 1) * stride)));
    }
    return result;
  };
}

export class LocalEmbeddingClient {
  private _pipeline: EmbedFn | null = null;

  /** Lazy-load the pipeline on first embed call, then cache it. */
  async embed(texts: string[]): Promise<number[][]> {
    if (!this._pipeline) {
      // Check module-level cache first (shared across instances)
      if (!_localPipeline) {
        _localPipeline = await _loadPipeline();
      }
      this._pipeline = _localPipeline;
    }
    return this._pipeline(texts);
  }
}
