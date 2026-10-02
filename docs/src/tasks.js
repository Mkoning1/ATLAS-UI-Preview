// Task-panel lifecycle, adaptive layout and history. Pure data logic, no DOM.

import { PRIORITIES, TERMINAL_STATUSES } from "./envelope.js";

export const HISTORY_CAP = 200;
const SLOTS = ["right", "left", "top", "bottom"];

/** Statuses that count as "live" (still occupying a panel). */
const LIVE_STATUSES = ["queued", "working", "review", "blocked"];

export class TaskStore {
  /** @param {{maxVisible?: number, now?: () => number, foldMs?: number}} opts */
  constructor({ maxVisible = 3, now = () => Date.now(), foldMs = 4000 } = {}) {
    this.maxVisible = maxVisible;
    this.now = now;
    this.foldMs = foldMs;
    this.tasks = new Map(); // taskId -> task record
    this.history = []; // newest first, immutable snapshots
    this.manualPositions = new Map(); // taskId -> {x,y} (user overrides)
    this.seq = 0;
  }

  /** Create a task (and its panel) from a validated envelope. */
  add(envelope) {
    if (this.tasks.has(envelope.taskId)) throw new Error(`duplicate task ${envelope.taskId}`);
    const task = {
      id: envelope.taskId,
      envelope: structuredClone(envelope),
      status: envelope.status,
      phaseLabel: "",
      progress: [], // concise human-readable lines
      trail: [], // technical execution trail (inspector)
      agents: [], // visualization-only agent entries
      panel: { state: "entering", complex: false, expanded: false },
      createdSeq: ++this.seq,
      touchedSeq: this.seq,
      finishedAt: null,
    };
    task.panel.complex = ["research", "develop"].includes(envelope.requestedAction);
    this.tasks.set(task.id, task);
    return task;
  }

  get(id) {
    return this.tasks.get(id);
  }

  /** Apply a bridge event to a task. Unknown tasks are ignored explicitly. */
  applyEvent(event) {
    const task = this.tasks.get(event.taskId);
    if (!task) return { applied: false, reason: "unknown_task" };
    if (TERMINAL_STATUSES.includes(task.status)) return { applied: false, reason: "task_terminal" };
    task.touchedSeq = ++this.seq;
    const at = event.at ?? new Date(this.now()).toISOString();
    task.trail.push({ at, type: event.type, owner: event.owner ?? null, detail: event.detail ?? "" });
    task.envelope.timestamps.updatedAt = at;

    switch (event.type) {
      case "status":
        task.status = event.status;
        if (event.owner) task.envelope.owner = event.owner;
        if (event.label) task.phaseLabel = event.label;
        if (event.approval) task.envelope.approval = event.approval;
        if (event.status === "working" && task.panel.state === "entering") task.panel.state = "visible";
        break;
      case "progress":
        task.progress.push(event.text);
        break;
      case "agent":
        upsertAgent(task, event.agent);
        break;
      case "result":
        task.status = "done";
        task.envelope.result = { summary: event.summary, simulated: Boolean(event.simulated) };
        task.envelope.timestamps.completedAt = at;
        task.finishedAt = this.now();
        task.agents.forEach((a) => (a.active = false));
        break;
      case "failure":
        task.status = event.cancelled ? "cancelled" : "failed";
        task.envelope.result = { summary: event.summary ?? "Task failed", simulated: Boolean(event.simulated) };
        task.envelope.timestamps.completedAt = at;
        task.finishedAt = this.now();
        task.agents.forEach((a) => (a.active = false));
        break;
      default:
        return { applied: false, reason: "unknown_event" };
    }
    task.envelope.status = task.status;
    return { applied: true };
  }

  /**
   * Finished tasks fold away after `foldMs`; heavy/critical results dissolve
   * (a cinematic exit) instead. Dismissed tasks are archived into history.
   * Returns ids newly archived.
   */
  sweep() {
    const archived = [];
    const t = this.now();
    for (const task of this.tasks.values()) {
      if (!TERMINAL_STATUSES.includes(task.status) || task.finishedAt === null) continue;
      if (task.panel.state === "visible" || task.panel.state === "entering") {
        task.panel.state = isHeavy(task) ? "dissolving" : "folding";
      }
      if (t - task.finishedAt >= this.foldMs) {
        archived.push(task.id);
        this.#archive(task);
      }
    }
    return archived;
  }

  /** Explicit dismissal by the user (also archives into history). */
  dismiss(id) {
    const task = this.tasks.get(id);
    if (!task) return false;
    if (!TERMINAL_STATUSES.includes(task.status)) return false; // live tasks cannot be dismissed silently
    this.#archive(task);
    return true;
  }

  #archive(task) {
    this.tasks.delete(task.id);
    this.manualPositions.delete(task.id);
    this.history.unshift({
      id: task.id,
      conversationId: task.envelope.conversationId,
      title: titleOf(task.envelope),
      status: task.status,
      archivedAt: new Date(this.now()).toISOString(),
      envelope: structuredClone(task.envelope),
      progress: [...task.progress],
      trail: [...task.trail],
    });
    if (this.history.length > HISTORY_CAP) this.history.length = HISTORY_CAP;
  }

  /** Read-only view of a history entry (a deep copy; mutation cannot leak back). */
  openHistory(id) {
    const entry = this.history.find((h) => h.id === id);
    return entry ? { ...structuredClone(entry), readOnly: true } : null;
  }

  /**
   * Explicit "continue": returns the seed for a NEW task linked to the old
   * conversation. The archived entry itself is never reactivated or mutated.
   */
  continueSeed(id) {
    const entry = this.history.find((h) => h.id === id);
    if (!entry) return null;
    return { conversationId: entry.conversationId, continuationOf: entry.id };
  }

  setManualPosition(id, pos) {
    if (this.tasks.has(id) && Number.isFinite(pos?.x) && Number.isFinite(pos?.y)) {
      this.manualPositions.set(id, { x: pos.x, y: pos.y });
    }
  }

  summary() {
    const s = { queued: 0, working: 0, review: 0, result: 0, blocked: 0, failed: 0 };
    for (const t of this.tasks.values()) {
      if (t.status === "queued") s.queued++;
      else if (t.status === "working") s.working++;
      else if (t.status === "review") s.review++;
      else if (t.status === "blocked") s.blocked++;
      else if (t.status === "done") s.result++;
      else if (t.status === "failed") s.failed++;
      else if (t.status === "cancelled") s.result += 0;
    }
    return s;
  }

  activeAgentCount() {
    let n = 0;
    for (const t of this.tasks.values()) n += t.agents.filter((a) => a.active).length;
    return n;
  }

  /** Deterministic panel layout: priority first, then recency; overflow is grouped. */
  layout() {
    return layoutPanels([...this.tasks.values()], { maxVisible: this.maxVisible, manual: this.manualPositions });
  }
}

function upsertAgent(task, agent) {
  const i = task.agents.findIndex((a) => a.id === agent.id);
  if (i >= 0) task.agents[i] = { ...task.agents[i], ...agent };
  else task.agents.push({ active: true, ...agent });
}

function isHeavy(task) {
  return (
    task.envelope.priority === "critical" ||
    task.status === "failed" ||
    task.panel.complex ||
    (task.envelope.result?.summary?.length ?? 0) > 600
  );
}

export function titleOf(envelope) {
  const t = envelope.input.text.trim().replace(/\s+/g, " ");
  if (t) return t.length > 60 ? `${t.slice(0, 57)}...` : t;
  return envelope.input.attachments[0]?.name ?? "Untitled task";
}

/**
 * @returns {{visible: Array, stacked: Array}} visible panels carry slot, depth and
 * (if the user moved them) a manual position. Stacked tasks are grouped for relevance.
 */
export function layoutPanels(tasks, { maxVisible = 3, manual = new Map() } = {}) {
  const rank = (t) => {
    const urgent = t.status === "blocked" || t.status === "failed" ? 10 : 0;
    return PRIORITIES[t.envelope.priority] * 100 + urgent * 100 + t.touchedSeq;
  };
  const sorted = [...tasks].filter((t) => LIVE_STATUSES.includes(t.status) || t.finishedAt !== null || t.status === "done" || t.status === "failed")
    .sort((a, b) => rank(b) - rank(a) || b.createdSeq - a.createdSeq);
  const visible = sorted.slice(0, maxVisible).map((t, i) => ({
    taskId: t.id,
    slot: SLOTS[i % SLOTS.length],
    depth: i, // 0 = frontmost; higher-priority panels sit nearer the viewer
    compact: !t.panel.complex,
    manual: manual.get(t.id) ?? null,
  }));
  const stacked = sorted.slice(maxVisible).map((t) => t.id);
  return { visible, stacked };
}
