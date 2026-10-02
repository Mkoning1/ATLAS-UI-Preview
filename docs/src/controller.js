// AtlasController: the DOM-free brain of the control surface. It owns the
// presentation state machine, the task store and the bridge adapter, and
// emits change/cue notifications for the view and audio layers.

import { createEnvelope, validateEnvelope } from "./envelope.js";
import { assertAdapter } from "./bridge/adapter.js";
import { transition } from "./state-machine.js";
import { TaskStore } from "./tasks.js";
import { visualFor } from "./visual-params.js";

const STATUS_TO_EVENT = {
  queued: "TASK_QUEUED",
  working: "TASK_STARTED",
  review: "TASK_REVIEW",
  blocked: "TASK_WARNING",
  done: "TASK_RESULT",
  failed: "TASK_CRITICAL",
};

export class AtlasController {
  constructor({ adapter, store = new TaskStore(), now = () => new Date().toISOString(), ids } = {}) {
    this.adapter = assertAdapter(adapter);
    this.store = store;
    this.nowIso = now;
    this.ids = ids; // optional deterministic id source for tests: () => ({command, task, conversation})
    this.state = "ACTIVATING";
    this.listeners = new Set();
    this.historyView = null; // read-only history entry being viewed
    this.pendingContinuation = null;
    this.lastError = null;
    this.unsubscribe = this.adapter.subscribe((e) => this.#onBridgeEvent(e));
  }

  on(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  #notify(kind, detail) {
    for (const l of [...this.listeners]) l({ kind, detail, state: this.state });
  }

  #dispatch(event) {
    const res = transition(this.state, event, this.store.summary());
    if (res.changed) {
      const from = this.state;
      this.state = res.state;
      this.#notify("state", { from, to: res.state, event });
    }
    return res.changed;
  }

  // ---- user-driven actions -------------------------------------------------
  assembled() {
    this.#dispatch("ASSEMBLED");
  }

  activate() {
    this.lastError = null;
    return this.#dispatch("CORE_ACTIVATE");
  }

  cancelInput() {
    this.pendingContinuation = null;
    return this.#dispatch("CANCEL");
  }

  /** @returns {Promise<{ok:boolean, errors?:object[], taskId?:string}>} */
  async submit({ text = "", attachments = [], priority = "normal" } = {}) {
    if (this.state !== "INPUT") return { ok: false, errors: [{ code: "not_in_input", field: "" }] };
    const seed = this.pendingContinuation ?? {};
    const envelope = createEnvelope(
      { text, attachments, priority, conversationId: seed.conversationId, continuationOf: seed.continuationOf },
      { now: this.nowIso(), ids: this.ids?.() ?? {} },
    );
    const v = validateEnvelope(envelope);
    if (!v.ok) {
      this.lastError = v.errors;
      this.#notify("rejected", v.errors);
      return { ok: false, errors: v.errors };
    }
    this.store.add(envelope);
    this.pendingContinuation = null;
    this.#dispatch("SUBMIT");
    this.#notify("cue", "send");
    let res;
    try {
      res = await this.adapter.submit(envelope);
    } catch (err) {
      res = { accepted: false, reason: err?.code ?? "adapter_error" };
    }
    if (!res.accepted) {
      this.store.applyEvent({ type: "failure", taskId: envelope.taskId, summary: `Not sent: ${res.reason}`, at: this.nowIso() });
      this.#dispatch("TASK_CRITICAL");
      this.#notify("cue", "critical");
      this.#notify("tasks", null);
      return { ok: false, errors: [{ code: res.reason ?? "rejected", field: "bridge" }], taskId: envelope.taskId };
    }
    this.#notify("tasks", null);
    return { ok: true, taskId: envelope.taskId };
  }

  async cancelTask(taskId) {
    const t = this.store.get(taskId);
    if (!t) return false;
    await this.adapter.cancel(taskId);
    return true;
  }

  acknowledge() {
    return this.#dispatch("ACKNOWLEDGE");
  }

  showHistory() {
    const ok = this.#dispatch("SHOW_HISTORY");
    if (ok) this.historyView = null;
    return ok;
  }

  showInspector() {
    return this.#dispatch("SHOW_INSPECT");
  }

  close() {
    this.historyView = null;
    return this.#dispatch("CLOSE");
  }

  /** Opens a history entry read-only. */
  openHistory(id) {
    if (this.state !== "HISTORY") return null;
    this.historyView = this.store.openHistory(id);
    this.#notify("history", this.historyView);
    return this.historyView;
  }

  /** Explicit "continue": a separate action that creates a NEW linked task seed. */
  continueHistory(id) {
    const seed = this.store.continueSeed(id);
    if (!seed || this.state !== "HISTORY") return false;
    this.pendingContinuation = seed;
    this.historyView = null;
    return this.#dispatch("CORE_ACTIVATE");
  }

  /** Periodic housekeeping (driven by the view's clock). */
  tick() {
    const archived = this.store.sweep();
    if (archived.length) {
      this.#dispatch("SETTLE");
      this.#notify("tasks", null);
    }
    return archived;
  }

  // ---- bridge events -------------------------------------------------------
  #onBridgeEvent(event) {
    const res = this.store.applyEvent(event);
    if (!res.applied) return;
    let machineEvent = null;
    if (event.type === "status") machineEvent = STATUS_TO_EVENT[event.status];
    else if (event.type === "result") machineEvent = "TASK_RESULT";
    else if (event.type === "failure") machineEvent = event.cancelled ? "SETTLE" : "TASK_CRITICAL";
    if (machineEvent) this.#dispatch(machineEvent);
    const cue = cueFor(event);
    if (cue) this.#notify("cue", cue);
    this.#notify("tasks", event);
  }

  // ---- view model ----------------------------------------------------------
  visual(extra = {}) {
    const layout = this.store.layout();
    return visualFor(this.state, {
      activeAgents: this.store.activeAgentCount(),
      visiblePanels: layout.visible.length,
      ...extra,
    });
  }

  inspectorModel() {
    return {
      bridge: this.adapter.describe(),
      tasks: [...this.store.tasks.values()].map((t) => ({
        id: t.id,
        status: t.status,
        owner: t.envelope.owner,
        approval: t.envelope.approval,
        agents: t.agents.map((a) => ({ ...a })),
        trail: [...t.trail],
      })),
    };
  }

  dispose() {
    this.unsubscribe();
    this.listeners.clear();
  }
}

function cueFor(event) {
  if (event.type === "result") return "complete";
  if (event.type === "failure") return event.cancelled ? null : "critical";
  if (event.type === "status" && event.status === "blocked") return "warning";
  if (event.type === "status" && event.status === "working") return "working";
  if (event.type === "agent" && event.agent?.active) return "agent";
  return null;
}
