// Pure view models: what text the panels may show. Text appears only when
// functional (working / presenting / warning / result) -- never a chat log.

import { titleOf } from "./tasks.js";

const CONCISE = {
  queued: "Received",
  working: "On it",
  review: "Checking",
  blocked: "Needs your decision",
  done: "Done",
  failed: "Something went wrong",
  cancelled: "Cancelled",
};

/** Phase labels are subtle by default; the explicit label shows on focus. */
export const PHASE_LABEL = {
  queued: "Queued",
  working: "Working",
  review: "Review",
  blocked: "Blocked",
  done: "Done",
  failed: "Failed",
  cancelled: "Cancelled",
};

export function panelModel(task) {
  const env = task.envelope;
  const result = env.result;
  const latest = task.progress.at(-1);
  return {
    taskId: task.id,
    title: titleOf(env),
    concise: latest && task.status === "working" ? latest : CONCISE[task.status] ?? task.status,
    phaseLabel: PHASE_LABEL[task.status] ?? task.status,
    tone: task.status === "failed" ? "critical" : task.status === "blocked" ? "warning" : "normal",
    complex: task.panel.complex,
    result: result ? result.summary : null,
    simulatedNotice: result?.simulated ? "Local simulation. Not a live ATLAS answer." : null,
    blocker: env.approval.state === "required" ? env.approval.blocker : null,
    canCancel: ["queued", "working", "review", "blocked"].includes(task.status),
    canDismiss: ["done", "failed", "cancelled"].includes(task.status),
    sections: task.panel.complex
      ? task.agents.map((a) => ({ id: a.id, label: a.label, active: a.active }))
      : [],
  };
}

export function historyModel(entries) {
  return entries.map((h) => ({
    id: h.id,
    title: h.title,
    status: h.status,
    archivedAt: h.archivedAt,
    simulated: Boolean(h.envelope.result?.simulated),
  }));
}

/** Human-readable validation messages for the command input. */
export function describeErrors(errors) {
  const MSG = {
    empty_command: "Type a command or attach something first.",
    possible_secret: "That looks like a password or key. ATLAS will not send it. Please remove it.",
    unsafe_link: "A link was rejected (only plain http/https links without a login are allowed).",
    too_long: "That is too long to send.",
    too_many: "Too many items attached.",
    disallowed_type: "That file type is not supported (images, text, PDF, JSON only).",
    invalid_size: "That file is too large.",
    BRIDGE_NOT_CONNECTED: "No live bridge is connected yet, so this command was not sent.",
    duplicate_command: "That command was already sent.",
  };
  return errors.map((e) => MSG[e.code] ?? `Cannot send (${e.code}).`);
}
