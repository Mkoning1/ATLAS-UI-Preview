// ATLAS command envelope (bridge contract v1).
//
// This is the single, explicit message shape exchanged between the ATLAS UI
// and any bridge adapter. It carries METADATA about attachments, never their
// bytes: no file content leaves the browser in this phase.

export const ENVELOPE_VERSION = 1;

export const REQUESTED_ACTIONS = Object.freeze([
  "ask",
  "research",
  "develop",
  "review",
  "status",
  "other",
]);

export const STATUSES = Object.freeze([
  "draft",
  "queued",
  "working",
  "review",
  "done",
  "blocked",
  "failed",
  "cancelled",
]);

export const TERMINAL_STATUSES = Object.freeze(["done", "failed", "cancelled"]);

export const PRIORITIES = Object.freeze({ low: 0, normal: 1, high: 2, critical: 3 });

export const OWNER_KINDS = Object.freeze(["atlas", "chatgpt", "claude", "bridge", "mock"]);

export const APPROVAL_STATES = Object.freeze(["none", "required", "granted", "denied"]);

export const LIMITS = Object.freeze({
  maxTextLength: 8000,
  maxLinks: 10,
  maxAttachments: 8,
  maxAttachmentBytes: 20 * 1024 * 1024,
  maxResultSummaryLength: 4000,
});

const ALLOWED_MIME = /^(image\/(png|jpeg|gif|webp)|text\/(plain|markdown|csv)|application\/(pdf|json))$/;

// Credential-looking strings must never travel through the browser.
// Patterns are assembled from fragments so this file itself is not a match.
const SECRET_PATTERNS = [
  new RegExp(["gh", "[pousr]_[A-Za-z0-9]{20,}"].join("")),
  new RegExp(["github", "_pat_[A-Za-z0-9_]{20,}"].join("")),
  new RegExp(["s", "k-[A-Za-z0-9_-]{20,}"].join("")),
  new RegExp(["AK", "IA[0-9A-Z]{16}"].join("")),
  new RegExp(["-----BEGIN [A-Z ]*PRIV", "ATE KEY-----"].join("")),
  new RegExp(["eyJ[A-Za-z0-9_-]{10,}\\.", "eyJ[A-Za-z0-9_-]{10,}\\."].join("")),
];

export function looksLikeSecret(text) {
  return typeof text === "string" && SECRET_PATTERNS.some((re) => re.test(text));
}

/** Extract http(s) links from free text, de-duplicated, order preserved. */
export function extractLinks(text) {
  if (typeof text !== "string") return [];
  const found = text.match(/https?:\/\/[^\s<>"')]+/gi) ?? [];
  return [...new Set(found.map((l) => l.replace(/[.,;:!?]+$/, "")))];
}

/** A link is acceptable only if it is http(s) and carries no embedded credentials. */
export function isSafeLink(link) {
  try {
    const u = new URL(link);
    if (u.protocol !== "https:" && u.protocol !== "http:") return false;
    if (u.username || u.password) return false;
    return true;
  } catch {
    return false;
  }
}

/** Reduce a File-like object to metadata only. Content is never read here. */
export function attachmentMetadata(file) {
  const mime = String(file?.type ?? "");
  return {
    name: String(file?.name ?? ""),
    mime,
    sizeBytes: Number(file?.size ?? 0),
    kind: mime.startsWith("image/") ? "image" : "file",
  };
}

let fallbackCounter = 0;
export function newId(prefix, rng) {
  if (rng) return `${prefix}_${rng()}`;
  const c = globalThis.crypto;
  if (c?.randomUUID) return `${prefix}_${c.randomUUID()}`;
  fallbackCounter += 1;
  return `${prefix}_${Date.now().toString(36)}${fallbackCounter}`;
}

/**
 * Build a new command envelope from raw user input.
 * `now` (ISO string) and `ids` ({command, conversation, task}) are injectable
 * so tests are deterministic.
 */
export function createEnvelope(
  { text = "", attachments = [], requestedAction, priority = "normal", conversationId, continuationOf },
  { now = new Date().toISOString(), ids = {} } = {},
) {
  const links = extractLinks(text);
  return {
    version: ENVELOPE_VERSION,
    commandId: ids.command ?? newId("cmd"),
    conversationId: conversationId ?? ids.conversation ?? newId("conv"),
    taskId: ids.task ?? newId("task"),
    input: {
      text,
      links,
      attachments: attachments.map(attachmentMetadata),
    },
    requestedAction: requestedAction ?? inferAction(text),
    status: "queued",
    priority,
    owner: { kind: "atlas", component: "ui-control-layer" },
    timestamps: { createdAt: now, updatedAt: now, completedAt: null },
    result: null,
    approval: { state: "none", blocker: null },
    continuationOf: continuationOf ?? null,
  };
}

/** Deterministic keyword inference; the UI never needs an LLM to pick an action. */
export function inferAction(text) {
  const t = String(text).toLowerCase();
  if (/\b(research|investigate|find out|compare)\b/.test(t)) return "research";
  if (/\b(implement|build|develop|fix|refactor)\b/.test(t)) return "develop";
  if (/\b(review|audit|check)\b/.test(t)) return "review";
  if (/\b(status|progress|where are we)\b/.test(t)) return "status";
  return "ask";
}

const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const isIso = (v) => typeof v === "string" && !Number.isNaN(Date.parse(v));

/** Validate an envelope. Returns {ok, errors[]}; never throws. */
export function validateEnvelope(env) {
  const errors = [];
  const err = (code, field) => errors.push({ code, field });

  if (!isObj(env)) return { ok: false, errors: [{ code: "not_object", field: "" }] };
  if (env.version !== ENVELOPE_VERSION) err("unsupported_version", "version");
  for (const f of ["commandId", "conversationId", "taskId"]) {
    if (typeof env[f] !== "string" || env[f].length === 0 || env[f].length > 128) err("invalid_id", f);
  }

  if (!isObj(env.input)) {
    err("missing", "input");
  } else {
    const { text, links, attachments } = env.input;
    if (typeof text !== "string") err("invalid_type", "input.text");
    else {
      if (text.length > LIMITS.maxTextLength) err("too_long", "input.text");
      if (looksLikeSecret(text)) err("possible_secret", "input.text");
    }
    if (!Array.isArray(links)) err("invalid_type", "input.links");
    else {
      if (links.length > LIMITS.maxLinks) err("too_many", "input.links");
      if (!links.every((l) => typeof l === "string" && isSafeLink(l))) err("unsafe_link", "input.links");
    }
    if (!Array.isArray(attachments)) err("invalid_type", "input.attachments");
    else {
      if (attachments.length > LIMITS.maxAttachments) err("too_many", "input.attachments");
      for (const a of attachments) {
        if (!isObj(a)) {
          err("invalid_type", "input.attachments[]");
          continue;
        }
        if (typeof a.name !== "string" || a.name === "" || /[\\/]/.test(a.name) || a.name.length > 255)
          err("invalid_name", "input.attachments[].name");
        if (typeof a.mime !== "string" || !ALLOWED_MIME.test(a.mime))
          err("disallowed_type", "input.attachments[].mime");
        if (!Number.isFinite(a.sizeBytes) || a.sizeBytes < 0 || a.sizeBytes > LIMITS.maxAttachmentBytes)
          err("invalid_size", "input.attachments[].sizeBytes");
        if ("content" in a || "data" in a || "dataUrl" in a) err("content_not_allowed", "input.attachments[]");
      }
    }
    if (typeof text === "string" && text.trim() === "" && Array.isArray(attachments) && attachments.length === 0)
      err("empty_command", "input");
  }

  if (!REQUESTED_ACTIONS.includes(env.requestedAction)) err("invalid_enum", "requestedAction");
  if (!STATUSES.includes(env.status)) err("invalid_enum", "status");
  if (!(env.priority in PRIORITIES)) err("invalid_enum", "priority");

  if (!isObj(env.owner) || !OWNER_KINDS.includes(env.owner.kind) || typeof env.owner.component !== "string")
    err("invalid_owner", "owner");

  if (!isObj(env.timestamps)) err("missing", "timestamps");
  else {
    if (!isIso(env.timestamps.createdAt)) err("invalid_timestamp", "timestamps.createdAt");
    if (!isIso(env.timestamps.updatedAt)) err("invalid_timestamp", "timestamps.updatedAt");
    const c = env.timestamps.completedAt;
    if (c !== null && !isIso(c)) err("invalid_timestamp", "timestamps.completedAt");
  }

  if (env.result !== null && env.result !== undefined) {
    if (!isObj(env.result) || typeof env.result.summary !== "string" || env.result.summary.length > LIMITS.maxResultSummaryLength)
      err("invalid_result", "result");
  }

  if (!isObj(env.approval) || !APPROVAL_STATES.includes(env.approval.state)) err("invalid_approval", "approval");
  else if (env.approval.state === "required" && typeof env.approval.blocker !== "string")
    err("blocker_required", "approval.blocker");

  return { ok: errors.length === 0, errors };
}
