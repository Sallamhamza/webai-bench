# SP4 — Is N=3 enough?

**Status:** Passed (single-device) · **Date:** 2026-07-21

**Question (docs/08-delivery-plan.md §2):** Variance study on ≥3 lab devices: rep-to-rep spread
with/without warmup, with/without visibility loss; recommendation memo (feeds `04` §5).

**Scope caveat:** this session had access to one real device (lead's machine, WebGPU-capable).
The delivery plan asks for ≥3 lab devices (Win/NVIDIA, macOS/Apple-Silicon, Android/Chrome,
iOS/Safari — see `08-delivery-plan.md` §6.4's device-lab protocol). Cross-device variance is
very likely larger than the within-device variance measured here — different GPUs, thermal
envelopes, and OS schedulers all plausibly widen the spread. **This spike validates the
within-device shape of the recommendation below; cross-device confirmation is deferred to the
mandatory device-lab protocol before any suite MAJOR/MINOR release, as that doc already requires.**

## Method

`apps/web/src/Sp4VarianceStudy.tsx`: loaded `SmolLM2-360M-Instruct-q4f16_1-MLC` once, then ran 12
reps of a fixed short prompt (32 max tokens) on the same engine, calling `resetChat()` between
reps (no re-download/re-init — isolates steady-state generation variance from one-time costs).
Rep 0 flagged as warmup. Two reps (10, 11) were deliberately visibility-interrupted by switching
browser tabs mid-generation, to observe background-tab throttling's effect on the numbers.

## Result

| rep | warmup? | visibility-interrupted? | TTFT (ms) | decode TPS |
|---|---|---|---|---|
| 0 | yes | | 6272.3 | 9.61 |
| 1 | | | 610.4 | 10.25 |
| 2 | | | 530.0 | 11.09 |
| 3 | | | 529.2 | 10.88 |
| 4 | | | 590.5 | 11.38 |
| 5 | | | 595.9 | 11.01 |
| 6 | | | 526.5 | 10.87 |
| 7 | | | 587.2 | 11.00 |
| 8 | | | 561.6 | 11.24 |
| 9 | | | 528.1 | 11.00 |
| 10 | | yes | 535.5 | 9.68 |
| 11 | | yes | 561.7 | 8.87 |

| group | n | mean | median | min | max | stdev | CV% |
|---|---|---|---|---|---|---|---|
| all reps (incl. warmup + interrupted) | 12 | 10.57 | 10.94 | 8.87 | 11.38 | 0.75 | 7.1% |
| with warmup, excl. interrupted | 10 | 10.83 | 11.00 | 9.61 | 11.38 | 0.50 | 4.6% |
| excl. warmup + interrupted (clean) | 9 | 10.97 | 11.00 | 10.25 | 11.38 | 0.30 | **2.7%** |
| visibility-interrupted only | 2 | 9.28 | 9.28 | 8.87 | 9.68 | 0.40 | 4.4% |

## Findings

1. **Warmup confirmed mandatory, and the effect is large.** Rep 0's TTFT (6,272 ms) is ~11× every
   clean rep's TTFT (~530–610 ms) — one-time WebGPU shader/pipeline compilation, exactly as SP2
   flagged. Its decode TPS (9.61) is also below the entire clean range (10.25–11.38). Including
   the warmup rep in any statistic materially drags it down and inflates CV (4.6% → vs. 2.7%
   clean). FR2.3's warmup-before-measuring requirement is load-bearing, not a nicety.

2. **Visibility-interrupted reps are measurably degraded, not just "maybe noisy."** Both
   interrupted reps (9.68, 8.87 decode TPS) fall below the entire clean range (10.25–11.38) —
   about 10–19% slower. This directly confirms FR2.6's rule that visibility-interrupted runs must
   be excluded from submission-eligible metrics: a single interrupted rep silently averaged in
   would measurably bias a small-N result downward.

3. **Steady-state (clean) variance is low on this device: CV ≈ 2.7%.** Min-max spread across 9
   clean reps is only 10.25–11.38 (≈10%), tightly clustered around the median of 11.00.

4. **Recommendation: N=3 with median (not mean) is adequate, provided warmup + visibility-guard
   both function.** With clean-rep CV this low, the standard error of a 3-sample mean would
   already be small (~1.6% of the mean). The real risk to a 3-rep window isn't ordinary variance —
   it's a single contaminated rep (visibility loss, thermal event, background OS activity) landing
   in the sample. Median of 3 tolerates exactly one such outlier without the result being pulled to
   the outlier's value, which is why `03-architecture.md` §5.8 already specifies median-based
   aggregation. **This spike doesn't argue for changing N=3 — it argues that N=3 only works
   because the surrounding guards (FR2.3 warmup, FR2.6 visibility guard, crash detection) are
   doing real work to keep contaminated reps out of the window in the first place.** If those
   guards were removed or weakened, N=3 would not be enough on its own.

## Recommendation memo (for `04-benchmark-methodology.md` §5)

Keep N=3 measured repetitions with median aggregation, contingent on: (a) at least 1 warmup rep
discarded before measuring begins, (b) the visibility guard (FR2.6) excluding any rep where the
tab lost visibility, and (c) cross-device confirmation via the device-lab protocol before this is
treated as validated beyond the single machine tested here.

## Exit artifact

This document (tables above) + `apps/web/src/Sp4VarianceStudy.tsx`.
