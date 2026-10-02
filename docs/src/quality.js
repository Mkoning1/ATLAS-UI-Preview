// Adaptive quality: initial tier from device hints, plus a runtime governor
// that steps down on sustained slow frames. Pure logic, testable in Node.

export const TIERS = Object.freeze({
  high: { particles: 9000, shellSegments: 360, impulses: 700, dprCap: 2, fps: 60, subCores: 4 },
  medium: { particles: 4500, shellSegments: 200, impulses: 350, dprCap: 1.5, fps: 60, subCores: 3 },
  low: { particles: 1800, shellSegments: 90, impulses: 140, dprCap: 1, fps: 30, subCores: 2 },
  minimal: { particles: 600, shellSegments: 0, impulses: 0, dprCap: 1, fps: 30, subCores: 1 },
});

export const TIER_ORDER = ["high", "medium", "low", "minimal"];

export function pickQuality({
  webgl = true,
  deviceMemory,
  hardwareConcurrency,
  width = 1280,
  coarsePointer = false,
  prefersReducedMotion = false,
  override,
} = {}) {
  if (override && TIERS[override]) return override;
  if (!webgl) return "minimal";
  const mem = deviceMemory ?? 8;
  const cores = hardwareConcurrency ?? 8;
  // level: 4 = high, 3 = medium, 2 = low, 1 = minimal
  let level = mem >= 8 && cores >= 8 && !coarsePointer && width >= 1100 ? 4 : 3;
  if (mem <= 2 || cores <= 2) level = 2;
  else if (coarsePointer && width < 700) level = 2;
  if (prefersReducedMotion) level = Math.min(level, 3);
  return TIER_ORDER[TIER_ORDER.length - level];
}

/**
 * Frame-time governor. Feed frame durations (ms); it recommends a step down
 * after `window` consecutive slow frames. It never steps back up on its own
 * (avoids oscillation); the Owner may raise quality explicitly.
 */
export class FrameGovernor {
  constructor({ tier = "high", budgetMs = 24, window = 45 } = {}) {
    this.tier = tier;
    this.budgetMs = budgetMs;
    this.window = window;
    this.slow = 0;
  }

  /** @returns {string|null} new tier if a downgrade is recommended */
  push(frameMs) {
    this.slow = frameMs > this.budgetMs ? this.slow + 1 : Math.max(0, this.slow - 2);
    if (this.slow >= this.window) {
      this.slow = 0;
      const i = TIER_ORDER.indexOf(this.tier);
      if (i < TIER_ORDER.length - 1) {
        this.tier = TIER_ORDER[i + 1];
        return this.tier;
      }
    }
    return null;
  }
}

/** Startup assembly length; shortened when ATLAS was opened recently. */
export function assemblyDurationMs({ now, lastOpenAt, prefersReducedMotion = false }) {
  if (prefersReducedMotion) return 400;
  if (typeof lastOpenAt !== "number") return 3200;
  const gap = now - lastOpenAt;
  if (gap < 2 * 60_000) return 1000;
  if (gap < 15 * 60_000) return 1800;
  return 3200;
}
