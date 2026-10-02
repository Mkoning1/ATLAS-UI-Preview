// Deterministic local simulation of the bridge. NOT a live ChatGPT/Claude
// connection; every result it produces is flagged `simulated: true`.

import { BridgeAdapter } from "./adapter.js";

const SCENARIOS = {
  simple: {
    steps: [
      { after: 400, event: { type: "status", status: "working", label: "Working", owner: { kind: "mock", component: "mock-agent" } } },
      { after: 900, event: { type: "progress", text: "Thinking it through" } },
      { after: 600, result: "Simulated answer." },
    ],
  },
  research: {
    steps: [
      { after: 400, event: { type: "status", status: "working", label: "Researching", owner: { kind: "mock", component: "mock-research" } } },
      { after: 300, event: { type: "agent", agent: { id: "a1", label: "Source scan", owner: "mock", active: true } } },
      { after: 300, event: { type: "agent", agent: { id: "a2", label: "Cross-check", owner: "mock", active: true } } },
      { after: 700, event: { type: "progress", text: "Collecting sources" } },
      { after: 900, event: { type: "status", status: "review", label: "Reviewing findings", owner: { kind: "mock", component: "mock-reviewer" } } },
      { after: 700, event: { type: "progress", text: "Findings checked" } },
      { after: 600, result: "Simulated research summary with three findings." },
    ],
  },
  warn: {
    steps: [
      { after: 400, event: { type: "status", status: "working", label: "Working", owner: { kind: "mock", component: "mock-agent" } } },
      {
        after: 700,
        event: {
          type: "status",
          status: "blocked",
          label: "Needs your decision",
          approval: { state: "required", blocker: "Simulated approval gate" },
        },
      },
    ],
  },
  fail: {
    steps: [
      { after: 400, event: { type: "status", status: "working", label: "Working", owner: { kind: "mock", component: "mock-agent" } } },
      { after: 800, failure: "Simulated critical failure." },
    ],
  },
};

export function scenarioFor(envelope) {
  const t = envelope.input.text.toLowerCase();
  if (/\bfail|critical\b/.test(t)) return "fail";
  if (/\bwarn|approve|approval\b/.test(t)) return "warn";
  if (envelope.requestedAction === "research" || envelope.requestedAction === "develop") return "research";
  return "simple";
}

export class MockBridgeAdapter extends BridgeAdapter {
  /**
   * @param {{schedule?: (fn:()=>void, ms:number)=>any, cancelSchedule?: (h:any)=>void, now?: () => string}} opts
   * `schedule` is injectable so tests run synchronously and deterministically.
   */
  constructor({ schedule = (fn, ms) => setTimeout(fn, ms), cancelSchedule = (h) => clearTimeout(h), now = () => new Date().toISOString() } = {}) {
    super();
    this.schedule = schedule;
    this.cancelSchedule = cancelSchedule;
    this.now = now;
    this.listeners = new Set();
    this.handles = new Map(); // taskId -> pending handle
    this.seen = new Set(); // idempotency: commandIds already accepted
  }

  describe() {
    return {
      kind: "mock",
      live: false,
      connected: false,
      description: "Local deterministic simulation. No ChatGPT/Claude/GitHub connection.",
    };
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  #emit(event) {
    const e = { at: this.now(), ...event };
    for (const l of [...this.listeners]) l(e);
  }

  async submit(envelope) {
    if (this.seen.has(envelope.commandId)) return { accepted: false, reason: "duplicate_command" };
    this.seen.add(envelope.commandId);
    const steps = SCENARIOS[scenarioFor(envelope)].steps;
    const taskId = envelope.taskId;
    this.#emit({ type: "status", taskId, status: "queued", label: "Queued", owner: { kind: "mock", component: "mock-bridge" } });
    let i = 0;
    const next = () => {
      const step = steps[i++];
      if (!step) return;
      const run = () => {
        if (step.event) this.#emit({ taskId, ...step.event });
        else if (step.result) this.#emit({ type: "result", taskId, summary: step.result, simulated: true });
        else if (step.failure) this.#emit({ type: "failure", taskId, summary: step.failure, simulated: true });
        if (step.result || step.failure) this.handles.delete(taskId);
        else next();
      };
      this.handles.set(taskId, this.schedule(run, step.after));
    };
    next();
    return { accepted: true };
  }

  async cancel(taskId) {
    const h = this.handles.get(taskId);
    if (h !== undefined) this.cancelSchedule(h);
    this.handles.delete(taskId);
    this.#emit({ type: "failure", taskId, summary: "Cancelled", cancelled: true, simulated: true });
  }
}
