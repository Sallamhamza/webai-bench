// FR2.7: "a clear cached models control exists." Best-effort, not exhaustive: WebLLM and
// Transformers.js both cache through the standard Cache Storage API, which this clears
// completely. wllama's CacheManager is IndexedDB-backed (adapters/QUIRKS.md) and has no
// standard-API equivalent to sweep generically from outside the library, so this does not
// clear wllama's cached GGUF files — a real, documented gap, not a silent omission.
export async function clearCachedModels(): Promise<void> {
  if (typeof caches === "undefined") return;
  const keys = await caches.keys();
  await Promise.all(keys.map((key) => caches.delete(key)));
}
