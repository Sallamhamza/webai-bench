// FR2.7: total cache size is displayed before download with an explicit size warning >= 300 MB.
// `expected_download_mb` is a registry-declared estimate (see schema.ts's doc comment on that
// field) rather than a measured figure, so this is "warn before a big download," not "here is
// your current on-disk cache size" — there's no cross-runtime API to introspect that (WebLLM's
// Cache-API usage, Transformers.js's ORT cache, and wllama's IndexedDB-backed CacheManager are
// three different storage mechanisms with no common size query).
export const SIZE_WARNING_THRESHOLD_MB = 300;

export function totalDownloadMb(cells: readonly { expected_download_mb: number }[]): number {
  return cells.reduce((sum, cell) => sum + cell.expected_download_mb, 0);
}

export function needsSizeWarning(totalMb: number): boolean {
  return totalMb >= SIZE_WARNING_THRESHOLD_MB;
}
