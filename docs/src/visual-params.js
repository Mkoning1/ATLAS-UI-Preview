// Maps presentation state -> restrained visual parameters. Pure; the renderer
// smooths toward these targets. Colors are the approved palette only.

export const PALETTE = Object.freeze({
  base: [0.02, 0.05, 0.09], // near-black steel blue
  steel: [0.1, 0.19, 0.29], // dark steel blue
  cyan: [0.0, 0.9, 1.0], // electric cyan (active energy)
  white: [0.86, 0.95, 1.0], // cool white (highlights/data)
  amber: [1.0, 0.69, 0.0], // warning
  red: [1.0, 0.2, 0.2], // critical
});

const BASE = { energy: 0.25, complexity: 0.0, pulseRate: 0.25, tint: "cyan", hud: false, inputOpen: false };

const BY_STATE = {
  IDLE: { energy: 0.22, complexity: 0.0, pulseRate: 0.2 },
  ACTIVATING: { energy: 0.5, complexity: 0.1, pulseRate: 0.4 },
  INPUT: { energy: 0.45, complexity: 0.05, pulseRate: 0.35, inputOpen: true },
  QUEUED: { energy: 0.4, complexity: 0.1, pulseRate: 0.45 },
  WORKING: { energy: 0.75, complexity: 0.5, pulseRate: 0.9, hud: true },
  REVIEW: { energy: 0.6, complexity: 0.35, pulseRate: 0.6, hud: true },
  RESULT: { energy: 0.5, complexity: 0.15, pulseRate: 0.4, hud: true },
  WARNING: { energy: 0.65, complexity: 0.3, pulseRate: 0.7, tint: "amber", hud: true },
  CRITICAL: { energy: 0.85, complexity: 0.3, pulseRate: 1.0, tint: "red", hud: true },
  HISTORY: { energy: 0.3, complexity: 0.0, pulseRate: 0.2, hud: true },
  INSPECT: { energy: 0.5, complexity: 0.4, pulseRate: 0.5, hud: true },
};

const clamp01 = (v) => Math.min(1, Math.max(0, v));

/**
 * @param {string} state
 * @param {{activeAgents?: number, visiblePanels?: number, speaking?: boolean}} ctx
 */
export function visualFor(state, ctx = {}) {
  const p = { ...BASE, ...(BY_STATE[state] ?? {}) };
  const agents = Math.max(0, ctx.activeAgents ?? 0);
  // Heavier analysis complexifies the structure moderately (capped), never wholesale.
  p.complexity = clamp01(p.complexity + Math.min(agents, 4) * 0.08);
  p.energy = clamp01(p.energy + Math.min(agents, 4) * 0.03);
  // The nucleus recedes behind information-heavy screens but stays visible.
  const panels = Math.max(0, ctx.visiblePanels ?? 0);
  p.recede = state === "HISTORY" || state === "INSPECT" ? 0.55 : clamp01(Math.min(panels, 3) * 0.12);
  // Speaking adds only a subtle extra pulse.
  p.speakPulse = ctx.speaking ? 0.12 : 0;
  p.subCores = Math.min(agents, 4);
  return p;
}
