// DOM wiring for the ATLAS control surface. All decisions live in the
// controller/state modules; this file only renders and forwards input.

import { AudioCues } from "./audio.js";
import { MockBridgeAdapter } from "./bridge/mock-adapter.js";
import { AtlasController } from "./controller.js";
import { LIMITS, extractLinks } from "./envelope.js";
import { FrameGovernor, TIERS, TIER_ORDER, assemblyDurationMs, pickQuality } from "./quality.js";
import { CoreRenderer, webglSupported } from "./render/core-renderer.js";
import { describeErrors, historyModel, panelModel } from "./view-model.js";

const $ = (id) => document.getElementById(id);
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
const params = new URLSearchParams(location.search);

const controller = new AtlasController({ adapter: new MockBridgeAdapter() });
const audio = new AudioCues();
const canvas = $("core");
const quality0 = pickQuality({
  webgl: webglSupported(),
  deviceMemory: navigator.deviceMemory,
  hardwareConcurrency: navigator.hardwareConcurrency,
  width: innerWidth,
  coarsePointer: matchMedia("(pointer: coarse)").matches,
  prefersReducedMotion: reducedMotion,
  override: params.get("quality") ?? undefined,
});
const renderer = new CoreRenderer(canvas, { tier: quality0, reducedMotion });
const governor = new FrameGovernor({ tier: quality0 });
document.body.dataset.quality = renderer.mode === "webgl2" ? quality0 : "minimal";

let attachments = [];
let chromeTimer = 0;
let lastFrame = performance.now();
let rafId = 0;

function resize() {
  renderer.resize(innerWidth, innerHeight, devicePixelRatio);
}
addEventListener("resize", resize);
resize();

// ---- startup: cinematic assembly on every open (shortened if reopened soon) ----
let lastOpenAt;
try {
  const v = Number(localStorage.getItem("atlas.lastOpenAt"));
  if (Number.isFinite(v) && v > 0) lastOpenAt = v;
  localStorage.setItem("atlas.lastOpenAt", String(Date.now()));
} catch {
  /* storage unavailable: use the full assembly */
}
const assemblyMs = params.has("noanim") ? 1 : assemblyDurationMs({ now: Date.now(), lastOpenAt, prefersReducedMotion: reducedMotion });
renderer.startAssembly(assemblyMs, performance.now());
setTimeout(() => controller.assembled(), assemblyMs);

// ---- render loop (paused when hidden; low fps cap in low tiers) ----
function loop(now) {
  rafId = requestAnimationFrame(loop);
  const minDelta = 1000 / TIERS[governor.tier].fps;
  if (now - lastFrame < minDelta - 1) return;
  const dt = Math.min(0.1, (now - lastFrame) / 1000);
  const t0 = performance.now();
  lastFrame = now;
  renderer.setTarget(controller.visual());
  renderer.frame(now, dt);
  const next = governor.push(performance.now() - t0 + (dt * 1000 - minDelta > 8 ? dt * 1000 - minDelta : 0));
  if (next && renderer.mode === "webgl2") {
    renderer.setTier(next);
    document.body.dataset.quality = next;
  }
}
document.addEventListener("visibilitychange", () => {
  if (document.hidden) cancelAnimationFrame(rafId);
  else {
    lastFrame = performance.now();
    rafId = requestAnimationFrame(loop);
  }
});
rafId = requestAnimationFrame(loop);
setInterval(() => controller.tick(), 500);

// ---- camera: manual inspection, otherwise cinematic ----
let dragging = null;
canvas.addEventListener("pointerdown", (e) => {
  dragging = { x: e.clientX, y: e.clientY, moved: false };
  canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener("pointermove", (e) => {
  showChrome();
  if (!dragging) return;
  const dx = e.clientX - dragging.x;
  const dy = e.clientY - dragging.y;
  if (Math.abs(dx) + Math.abs(dy) > 3) dragging.moved = true;
  dragging.x = e.clientX;
  dragging.y = e.clientY;
  renderer.camera.drag(dx * 0.006, dy * 0.006, performance.now());
});
canvas.addEventListener("pointerup", (e) => {
  const wasTap = dragging && !dragging.moved;
  dragging = null;
  if (wasTap) maybeActivateAt(e.clientX, e.clientY);
});
canvas.addEventListener("wheel", (e) => {
  e.preventDefault();
  renderer.camera.zoom(e.deltaY * 0.004, performance.now());
}, { passive: false });

function maybeActivateAt(x, y) {
  const r = Math.min(innerWidth, innerHeight) * 0.24;
  if (Math.hypot(x - innerWidth / 2, y - innerHeight / 2) <= r) openInput();
}

function showChrome() {
  document.body.dataset.chrome = "1";
  clearTimeout(chromeTimer);
  chromeTimer = setTimeout(() => delete document.body.dataset.chrome, 3000);
}

// ---- command input ----
const form = $("command");
const text = $("cmd-text");

function openInput() {
  audio.enable();
  if (controller.state === "INPUT") return;
  if (controller.activate()) text.focus();
}
$("activator").addEventListener("click", openInput);

text.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    form.requestSubmit();
  } else if (e.key === "Escape") controller.cancelInput();
});
text.addEventListener("input", () => {
  text.style.height = "auto";
  text.style.height = `${Math.min(text.scrollHeight, 128)}px`;
  renderChips();
});
form.addEventListener("paste", (e) => {
  const files = [...(e.clipboardData?.files ?? [])];
  if (files.length) {
    e.preventDefault();
    addFiles(files);
  }
});
$("cmd-file").addEventListener("change", (e) => {
  addFiles([...e.target.files]);
  e.target.value = "";
});

function addFiles(files) {
  for (const f of files) {
    if (attachments.length >= LIMITS.maxAttachments) break;
    attachments.push(f); // held locally; only metadata ever enters the envelope
  }
  renderChips();
}

function renderChips() {
  const box = $("cmd-chips");
  box.replaceChildren();
  const chip = (label) => {
    const s = document.createElement("span");
    s.className = "chip";
    s.textContent = label;
    box.append(s);
  };
  attachments.forEach((f) => chip(`${f.type.startsWith("image/") ? "Image" : "File"}: ${f.name || "pasted"}`));
  extractLinks(text.value).forEach((l) => chip(`Link: ${safeHost(l)}`));
}
const safeHost = (l) => {
  try {
    return new URL(l).host;
  } catch {
    return "invalid";
  }
};

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const files = attachments.map((f, i) => (f.name ? f : new File([f], `pasted-${i + 1}.png`, { type: f.type })));
  const res = await controller.submit({ text: text.value, attachments: files });
  if (!res.ok && controller.state === "INPUT") {
    $("cmd-error").textContent = describeErrors(res.errors).join(" ");
    return;
  }
  $("cmd-error").textContent = "";
  text.value = "";
  attachments = [];
  text.style.height = "auto";
  renderChips();
});

// ---- rendering of controller state -> DOM ----
const panelEls = new Map();
const announce = (msg) => {
  $("live").textContent = msg;
};

function render() {
  const st = controller.state;
  document.body.dataset.state = st;
  document.body.dataset.hud = controller.visual().hud ? "1" : "0";
  form.hidden = st !== "INPUT";
  $("activator").setAttribute("aria-expanded", String(st === "INPUT"));
  $("history").hidden = st !== "HISTORY";
  $("inspector").hidden = st !== "INSPECT";
  if (st === "HISTORY") renderHistory();
  if (st === "INSPECT") renderInspector();
  renderPanels();
}

function renderPanels() {
  const { visible, stacked } = controller.store.layout();
  const host = $("panels");
  const keep = new Set(visible.map((v) => v.taskId));
  // panels that have left the layout (archived or stacked) are removed
  for (const [id, el] of panelEls) {
    const task = controller.store.get(id);
    if (!keep.has(id) && !task) {
      el.remove();
      panelEls.delete(id);
    } else if (!keep.has(id)) el.hidden = true;
  }
  for (const v of visible) {
    const task = controller.store.get(v.taskId);
    if (!task) continue;
    const m = panelModel(task);
    let el = panelEls.get(v.taskId);
    if (!el) {
      el = document.createElement("article");
      el.className = "panel";
      el.tabIndex = 0;
      el.dataset.taskId = v.taskId;
      host.append(el);
      panelEls.set(v.taskId, el);
      makeDraggable(el, v.taskId);
      requestAnimationFrame(() => (el.dataset.state = task.panel.state === "entering" ? "visible" : task.panel.state));
    }
    el.hidden = false;
    el.className = `panel tone-${m.tone}`;
    if (el.dataset.state && task.panel.state !== "entering") el.dataset.state = task.panel.state;
    placePanel(el, v);
    fillPanel(el, m);
  }
  let chip = host.querySelector(".stack-chip");
  if (stacked.length) {
    if (!chip) {
      chip = document.createElement("div");
      chip.className = "stack-chip";
      host.append(chip);
    }
    chip.textContent = `+${stacked.length} more`;
  } else chip?.remove();
}

const SLOT_POS = {
  right: { left: "calc(50% + var(--core-r) * 1.25)", top: "calc(50% - 80px)" },
  left: { left: "calc(50% - var(--core-r) * 1.25 - min(300px, 44vw))", top: "calc(50% - 40px)" },
  top: { left: "calc(50% - min(300px, 44vw) / 2)", top: "calc(50% - var(--core-r) * 1.7)" },
  bottom: { left: "calc(50% - min(300px, 44vw) / 2)", top: "calc(50% + var(--core-r) * 1.4)" },
};

function placePanel(el, v) {
  const narrow = innerWidth <= 640;
  const pos = narrow ? { left: "16px", top: `calc(12px + ${v.depth} * 6px)` } : SLOT_POS[v.slot];
  el.style.left = pos.left;
  el.style.top = pos.top;
  const mx = v.manual?.x ?? 0;
  const my = v.manual?.y ?? 0;
  el.style.transform = `translate3d(${mx}px, ${my}px, ${-v.depth * 60}px) rotateY(${v.slot === "left" ? 6 : v.slot === "right" ? -6 : 0}deg)`;
  el.style.zIndex = String(10 - v.depth);
}

function fillPanel(el, m) {
  const sig = JSON.stringify(m);
  if (el.dataset.sig === sig) return;
  el.dataset.sig = sig;
  const h = document.createElement("h2");
  h.textContent = m.title;
  const concise = document.createElement("div");
  concise.className = "concise";
  concise.textContent = m.blocker ? `${m.concise}: ${m.blocker}` : m.concise;
  const phase = document.createElement("span");
  phase.className = "phase";
  phase.textContent = m.phaseLabel;
  el.replaceChildren(h, concise, phase);
  if (m.sections.length) {
    const ul = document.createElement("ul");
    ul.className = "sections";
    for (const s of m.sections) {
      const li = document.createElement("li");
      li.dataset.active = s.active ? "1" : "0";
      li.textContent = s.label;
      ul.append(li);
    }
    el.append(ul);
  }
  if (m.result) {
    const p = document.createElement("p");
    p.className = "result";
    p.textContent = m.result;
    el.append(p);
  }
  if (m.simulatedNotice) {
    const p = document.createElement("p");
    p.className = "sim";
    p.textContent = m.simulatedNotice;
    el.append(p);
  }
  const acts = document.createElement("div");
  acts.className = "acts";
  const btn = (label, fn) => {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = label;
    b.addEventListener("click", fn);
    acts.append(b);
  };
  if (m.canCancel) btn("Cancel", () => controller.cancelTask(m.taskId));
  if (m.canDismiss) btn("Dismiss", () => controller.store.dismiss(m.taskId) && (controller.tick(), render()));
  if (controller.state === "WARNING" || controller.state === "CRITICAL") btn("Acknowledge", () => controller.acknowledge());
  if (acts.children.length) el.append(acts);
}

function makeDraggable(el, id) {
  let start = null;
  el.addEventListener("pointerdown", (e) => {
    if (e.target.closest("button")) return;
    const cur = controller.store.manualPositions.get(id) ?? { x: 0, y: 0 };
    start = { px: e.clientX, py: e.clientY, x: cur.x, y: cur.y };
    el.setPointerCapture(e.pointerId);
  });
  el.addEventListener("pointermove", (e) => {
    if (!start) return;
    controller.store.setManualPosition(id, { x: start.x + e.clientX - start.px, y: start.y + e.clientY - start.py });
    renderPanels();
  });
  el.addEventListener("pointerup", () => (start = null));
  el.addEventListener("keydown", (e) => {
    const step = e.shiftKey ? 40 : 12;
    const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
    if (!d || !e.altKey) return;
    e.preventDefault();
    const cur = controller.store.manualPositions.get(id) ?? { x: 0, y: 0 };
    controller.store.setManualPosition(id, { x: cur.x + d[0], y: cur.y + d[1] });
    renderPanels();
  });
}

function renderHistory() {
  const sheet = $("history");
  const items = historyModel(controller.store.history);
  const h = document.createElement("h2");
  h.textContent = "History";
  sheet.replaceChildren(h);
  if (controller.historyView) {
    const v = controller.historyView;
    const ro = document.createElement("div");
    ro.className = "ro";
    ro.textContent = "Read-only";
    const body = document.createElement("pre");
    body.textContent = `${v.title}\n\n${v.envelope.input.text}\n\n${v.envelope.result?.summary ?? ""}`;
    const cont = button("Continue", () => controller.continueHistory(v.id));
    const back = button("Back", () => {
      controller.historyView = null;
      render();
    });
    sheet.append(ro, body, cont, back);
    return;
  }
  const ul = document.createElement("ul");
  if (!items.length) {
    const li = document.createElement("li");
    li.textContent = "Nothing yet.";
    ul.append(li);
  }
  for (const it of items) {
    const li = document.createElement("li");
    const label = document.createElement("span");
    label.textContent = `${it.title} (${it.status}${it.simulated ? ", simulated" : ""})`;
    li.append(label, button("Open", () => controller.openHistory(it.id)));
    ul.append(li);
  }
  sheet.append(ul, button("Close", () => controller.close()));
}

function renderInspector() {
  const m = controller.inspectorModel();
  const sheet = $("inspector");
  const h = document.createElement("h2");
  h.textContent = "Technical inspector";
  const bridge = document.createElement("pre");
  bridge.textContent = `Bridge: ${m.bridge.kind} | live: ${m.bridge.live} | connected: ${m.bridge.connected}\n${m.bridge.description}`;
  sheet.replaceChildren(h, bridge);
  for (const t of m.tasks) {
    const pre = document.createElement("pre");
    const trail = t.trail.map((e) => `${e.at} ${e.type}${e.detail ? ` ${e.detail}` : ""}`).join("\n");
    pre.textContent = `${t.id}\nstatus: ${t.status}  owner: ${t.owner.kind}/${t.owner.component}  approval: ${t.approval.state}\nagents: ${t.agents.map((a) => a.label).join(", ") || "none"}\n${trail}`;
    sheet.append(pre);
  }
  sheet.append(button("Close", () => controller.close()));
}

function button(label, fn) {
  const b = document.createElement("button");
  b.type = "button";
  b.textContent = label;
  b.addEventListener("click", fn);
  return b;
}

controller.on((ev) => {
  if (ev.kind === "cue") audio.play(ev.detail);
  if (ev.kind === "state" || ev.kind === "tasks" || ev.kind === "history") {
    render();
    if (ev.kind === "state") announce(`State: ${ev.state.toLowerCase()}`);
  }
});
render();

// ---- toolbar + keyboard ----
const bar = $("toolbar");
bar.addEventListener("click", (e) => {
  const act = e.target.closest("button")?.dataset.act;
  if (!act) return;
  audio.enable();
  if (act === "history") controller.state === "HISTORY" ? controller.close() : controller.showHistory();
  else if (act === "inspect") controller.state === "INSPECT" ? controller.close() : controller.showInspector();
  else if (act === "sound") {
    const on = e.target.getAttribute("aria-pressed") !== "true";
    e.target.setAttribute("aria-pressed", String(on));
    audio.setMuted(!on);
  } else if (act === "quality") {
    const i = (TIER_ORDER.indexOf(governor.tier) + 1) % TIER_ORDER.length;
    governor.tier = TIER_ORDER[i];
    if (renderer.mode === "webgl2") renderer.setTier(governor.tier);
    document.body.dataset.quality = governor.tier;
    announce(`Quality: ${governor.tier}`);
  }
});
addEventListener("keydown", (e) => {
  showChrome();
  if (e.target instanceof HTMLTextAreaElement || e.ctrlKey || e.metaKey) return;
  if (e.key === "h") controller.state === "HISTORY" ? controller.close() : controller.showHistory();
  else if (e.key === "i") controller.state === "INSPECT" ? controller.close() : controller.showInspector();
  else if (e.key === "m") bar.querySelector('[data-act="sound"]').click();
  else if (e.key === "Escape") {
    if (controller.state === "HISTORY" || controller.state === "INSPECT") controller.close();
  }
});
addEventListener("pointermove", showChrome);
