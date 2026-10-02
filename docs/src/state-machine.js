// ATLAS UI presentation state machine. Pure and deterministic: no DOM, no timers.

export const STATES = Object.freeze([
  "IDLE",
  "ACTIVATING",
  "INPUT",
  "QUEUED",
  "WORKING",
  "REVIEW",
  "RESULT",
  "WARNING",
  "CRITICAL",
  "HISTORY",
  "INSPECT",
]);

/**
 * Where the UI settles when an overlay/alert is dismissed, derived from tasks.
 * `summary` = {queued, working, review, result} counts of live tasks.
 */
export function restingState(summary = {}) {
  if (summary.working > 0) return "WORKING";
  if (summary.review > 0 || summary.blocked > 0) return "REVIEW";
  if (summary.queued > 0) return "QUEUED";
  if (summary.result > 0) return "RESULT";
  return "IDLE";
}

// Events that are valid from the "live" states (task-driven transitions).
const TASK_EVENTS = {
  TASK_QUEUED: "QUEUED",
  TASK_STARTED: "WORKING",
  TASK_REVIEW: "REVIEW",
  TASK_RESULT: "RESULT",
  TASK_WARNING: "WARNING",
  TASK_CRITICAL: "CRITICAL",
};

const LIVE = ["IDLE", "QUEUED", "WORKING", "REVIEW", "RESULT"];

function liveTransitions() {
  return {
    ...TASK_EVENTS,
    CORE_ACTIVATE: "INPUT",
    SHOW_HISTORY: "HISTORY",
    SHOW_INSPECT: "INSPECT",
    SETTLE: "@rest",
  };
}

const TABLE = {
  ACTIVATING: { ASSEMBLED: "IDLE", SKIP: "IDLE" },
  INPUT: { SUBMIT: "QUEUED", CANCEL: "@rest", SHOW_HISTORY: "HISTORY", SHOW_INSPECT: "INSPECT" },
  WARNING: { ACKNOWLEDGE: "@rest", TASK_CRITICAL: "CRITICAL", SHOW_INSPECT: "INSPECT", CORE_ACTIVATE: "INPUT" },
  // A critical alert cannot be dismissed except by explicit acknowledgement.
  CRITICAL: { ACKNOWLEDGE: "@rest", SHOW_INSPECT: "INSPECT" },
  HISTORY: { CLOSE: "@rest", SHOW_INSPECT: "INSPECT", CORE_ACTIVATE: "INPUT", TASK_CRITICAL: "CRITICAL", TASK_WARNING: "WARNING" },
  INSPECT: { CLOSE: "@rest", SHOW_HISTORY: "HISTORY", CORE_ACTIVATE: "INPUT", TASK_CRITICAL: "CRITICAL", TASK_WARNING: "WARNING" },
};
for (const s of LIVE) TABLE[s] = liveTransitions();

/**
 * Compute the next state. Unknown or disallowed events leave the state
 * unchanged and report `changed: false` (explicit, never throws).
 */
export function transition(state, event, summary = {}) {
  const row = TABLE[state];
  if (!row) return { state, changed: false, reason: "unknown_state" };
  const target = row[event];
  if (!target) return { state, changed: false, reason: "event_not_allowed" };
  const next = target === "@rest" ? restingState(summary) : target;
  return { state: next, changed: next !== state, reason: null };
}

export function allowedEvents(state) {
  return Object.keys(TABLE[state] ?? {});
}
