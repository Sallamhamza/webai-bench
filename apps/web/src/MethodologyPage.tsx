import { REGISTRY } from "@webai-bench/registry";

// E5: the methodology page (FR6.1's "/methodology", changelog-on-bump). Content here is a
// condensed, faithful rendering of docs/04-benchmark-methodology.md — the normative source of
// truth. If this page and that doc ever disagree, the doc wins; update this page to match, not
// the other way around (04's own header: "this document is law").
export function MethodologyPage() {
  return (
    <article>
      <h2>Methodology</h2>

      <section aria-labelledby="meth-status">
        <h3 id="meth-status">Where this actually stands right now</h3>
        <p>
          This is an early prototype, not a finished benchmark lab. One runtime — WebLLM on WebGPU —
          has been run end-to-end in a real browser and its numbers cross-checked against the
          runtime's own self-reported stats (agreement within ~1-2%). Transformers.js and wllama are
          wired up and pass the same conformance tests, but haven't yet had that real-browser
          exercise — their first real run will be whenever a visitor actually runs one of their
          cells. Two things aren't verified yet either: whether the Stop button reliably cancels a
          real in-flight generation, and whether every real error a runtime can throw maps to a
          sensible status. None of this is hidden — see the project's{" "}
          <code>adapters/QUIRKS.md</code> for the specifics. If something looks wrong, that's useful
          to hear about.
        </p>
      </section>

      <section aria-labelledby="meth-what">
        <h3 id="meth-what">What we measure, and what we don&rsquo;t</h3>
        <p>
          Performance and compatibility of in-browser inference: does a given (model, quantization,
          runtime, backend) cell run on this device, how fast does it start, how fast does it
          generate. We do not measure model output quality, and download time is never mixed into
          compute metrics.
        </p>
      </section>

      <section aria-labelledby="meth-metrics">
        <h3 id="meth-metrics">Metrics of record</h3>
        <p>
          Every timing metric is a wall-clock bracket from <code>performance.now()</code>, taken in
          the same execution context as the runtime call. Runtimes&rsquo; own self-reported stats
          are stored alongside for cross-validation but are never the number of record.
        </p>
        <ul>
          <li>
            <strong>init_ms</strong> — cold init time, weights already local, engine setup +
            shader/JIT compilation included.
          </li>
          <li>
            <strong>ttft_ms</strong> — time to first token, prefill included.
          </li>
          <li>
            <strong>decode_tps</strong> — tokens/second for a fixed 128-token generation, greedy
            decoding, excluding TTFT by construction.
          </li>
          <li>
            <strong>embed_sps</strong> — sentences/second for one batch of 64 standard sentences.
          </li>
        </ul>
      </section>

      <section aria-labelledby="meth-procedure">
        <h3 id="meth-procedure">Run procedure</h3>
        <p>
          For each selected cell, in order: preflight capability check, acquire weights (or cache
          hit), one discarded warmup pass, then 3 measured repetitions with a 500ms cooldown between
          them. The median of the 3 reps is what gets reported; min/max are kept too. If the tab
          loses visibility mid-run, the cell still finishes but is flagged and excluded from
          submission-eligible metrics. Every stage has a watchdog timeout, declared per cell in the
          registry, so one stuck cell can&rsquo;t block the rest of a run.
        </p>
      </section>

      <section aria-labelledby="meth-validity">
        <h3 id="meth-validity">Validity — the honest limitations</h3>
        <ul>
          <li>
            <strong>External validity:</strong> visitors who show up here are enthusiast-skewed, not
            a random sample of devices in the world. Nothing here claims market share.
          </li>
          <li>
            <strong>Instrument validity:</strong> the harness itself has overhead; we budget for it
            to stay under 2% of a measured workload.
          </li>
          <li>
            <strong>Comparability across runtimes:</strong> different runtimes tokenize differently,
            so raw tokens/second across runtimes carries a caveat — tokens-generated is always shown
            alongside.
          </li>
          <li>
            <strong>Reliability over time:</strong> runtime and browser updates shift results, which
            is exactly why every result records the runtime version and suite version it ran under,
            rather than assuming numbers stay comparable forever.
          </li>
        </ul>
      </section>

      <section aria-labelledby="meth-versioning">
        <h3 id="meth-versioning">Suite versioning</h3>
        <p>
          Current suite version: <strong>{REGISTRY.suite_version}</strong>. A MAJOR bump means
          something changed that breaks comparability with earlier results (procedure, fixtures,
          timing rules, or a model/quant swap within an existing cell) — aggregates never mix MAJOR
          versions. MINOR is additive-only (new cells, new optional metrics). PATCH never touches
          the measurement path at all.
        </p>
      </section>

      <p>
        Full normative detail lives in <code>docs/04-benchmark-methodology.md</code> in the project
        repository — this page is a summary of it, not a replacement.
      </p>
    </article>
  );
}
