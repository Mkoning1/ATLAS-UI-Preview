// WebGL2 nucleus renderer (with a lightweight Canvas2D fallback).
// Rendering is deliberately separated from state logic: it only consumes the
// target parameters produced by visual-params.js.

import { PALETTE } from "../visual-params.js";
import { TIERS } from "../quality.js";
import { CameraController, lookAt, multiply, perspective } from "./camera.js";
import { buildNucleus } from "./geometry.js";
import { LINE_FS, LINE_VS, POINT_FS, POINT_VS } from "./shaders.js";

const TINTS = { cyan: PALETTE.cyan, amber: PALETTE.amber, red: PALETTE.red };

export function webglSupported() {
  try {
    const c = document.createElement("canvas");
    return Boolean(c.getContext("webgl2"));
  } catch {
    return false;
  }
}

export class CoreRenderer {
  constructor(canvas, { tier = "high", reducedMotion = false } = {}) {
    this.canvas = canvas;
    this.tier = tier;
    this.reducedMotion = reducedMotion;
    this.camera = new CameraController({ reducedMotion });
    this.target = { energy: 0.22, complexity: 0, pulseRate: 0.2, tint: "cyan", recede: 0, speakPulse: 0, subCores: 0 };
    this.cur = { energy: 0.22, complexity: 0, tint: [...PALETTE.cyan], recede: 0, pulse: 0, subCores: 0 };
    this.assemble = 0;
    this.assembleMs = 3200;
    this.assembleStart = null;
    this.subCores = [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]];
    this.gl = canvas.getContext("webgl2", { alpha: true, antialias: false, premultipliedAlpha: false });
    this.mode = this.gl ? "webgl2" : "canvas2d";
    if (this.gl) this.#initGL();
    else this.ctx2d = canvas.getContext("2d");
  }

  setTarget(params) {
    this.target = { ...this.target, ...params };
  }

  setTier(tier) {
    if (!TIERS[tier] || tier === this.tier) return;
    this.tier = tier;
    if (this.gl) this.#upload();
  }

  startAssembly(durationMs, nowMs) {
    this.assembleMs = durationMs;
    this.assembleStart = nowMs;
    this.assemble = 0;
  }

  resize(cssW, cssH, dpr) {
    const d = Math.min(dpr || 1, TIERS[this.tier].dprCap);
    this.canvas.width = Math.max(1, Math.floor(cssW * d));
    this.canvas.height = Math.max(1, Math.floor(cssH * d));
    this.dpr = d;
  }

  #initGL() {
    const gl = this.gl;
    this.progPoint = link(gl, POINT_VS, POINT_FS);
    this.progLine = link(gl, LINE_VS, LINE_FS);
    this.bufPoints = gl.createBuffer();
    this.bufLines = gl.createBuffer();
    this.#upload();
  }

  #upload() {
    const gl = this.gl;
    const g = buildNucleus(TIERS[this.tier]);
    this.geo = g;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.bufPoints);
    gl.bufferData(gl.ARRAY_BUFFER, g.points, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.bufLines);
    gl.bufferData(gl.ARRAY_BUFFER, g.lines, gl.STATIC_DRAW);
  }

  /** Advance simulation and draw one frame. */
  frame(nowMs, dt) {
    const c = this.cur;
    const t = this.target;
    const k = 1 - Math.exp(-dt * 3);
    c.energy += (t.energy - c.energy) * k;
    c.complexity += (t.complexity - c.complexity) * k * 0.6;
    c.recede += ((t.recede ?? 0) - c.recede) * k;
    c.subCores += ((t.subCores ?? 0) - c.subCores) * k;
    const tint = TINTS[t.tint] ?? PALETTE.cyan;
    for (let i = 0; i < 3; i++) c.tint[i] += (tint[i] - c.tint[i]) * k;
    // Idle breathing: always a very subtle pulse. In reduced-motion the pulse is a static offset.
    const rate = this.reducedMotion ? 0 : t.pulseRate;
    c.pulse = this.reducedMotion ? 0.02 * c.energy : (Math.sin(nowMs / 1000 * (0.6 + rate * 2)) * 0.5 + 0.5) * 0.04 * (0.5 + c.energy) + (t.speakPulse ?? 0) * (Math.sin(nowMs / 90) * 0.5 + 0.5);

    if (this.assembleStart !== null) {
      this.assemble = Math.min(1, (nowMs - this.assembleStart) / this.assembleMs);
      if (this.assemble >= 1) this.assembleStart = null;
    } else if (this.assemble === 0) {
      this.assemble = 1;
    }
    this.camera.update(dt, nowMs);
    this.#updateSubCores(nowMs);
    if (this.gl) this.#drawGL(nowMs);
    else this.#draw2D(nowMs);
    return this.assemble >= 1;
  }

  #updateSubCores(nowMs) {
    for (let i = 0; i < 4; i++) {
      const on = Math.max(0, Math.min(1, this.cur.subCores - i));
      const a = (i / 4) * Math.PI * 2 + nowMs / 9000 + i;
      const r = 1.1 + 0.15 * Math.sin(nowMs / 3000 + i * 2);
      this.subCores[i] = [Math.cos(a) * r, Math.sin(a * 0.7) * 0.5, Math.sin(a) * r, on];
    }
  }

  #drawGL(nowMs) {
    const gl = this.gl;
    const w = this.canvas.width;
    const h = this.canvas.height;
    gl.viewport(0, 0, w, h);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE); // additive: light, not solid
    const view = lookAt(this.camera.eye());
    const vp = multiply(perspective(0.9, w / h, 0.1, 30), view);
    const scale = 1.25 * (1.0 - 0.18 * this.cur.recede);
    for (const [prog, buf, count, mode] of [
      [this.progLine, this.bufLines, this.geo.lineVertexCount, gl.LINES],
      [this.progPoint, this.bufPoints, this.geo.pointCount, gl.POINTS],
    ]) {
      if (!count) continue;
      gl.useProgram(prog);
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      const aDir = gl.getAttribLocation(prog, "aDir");
      const aMeta = gl.getAttribLocation(prog, "aMeta");
      gl.enableVertexAttribArray(aDir);
      gl.vertexAttribPointer(aDir, 3, gl.FLOAT, false, 24, 0);
      gl.enableVertexAttribArray(aMeta);
      gl.vertexAttribPointer(aMeta, 3, gl.FLOAT, false, 24, 12);
      const u = (n) => gl.getUniformLocation(prog, n);
      gl.uniformMatrix4fv(u("uViewProj"), false, vp);
      gl.uniform1f(u("uTime"), nowMs / 1000);
      gl.uniform1f(u("uEnergy"), this.cur.energy);
      gl.uniform1f(u("uComplexity"), this.cur.complexity);
      gl.uniform1f(u("uPulse"), this.cur.pulse);
      gl.uniform1f(u("uAssemble"), this.assemble);
      gl.uniform1f(u("uRecede"), this.cur.recede);
      gl.uniform1f(u("uScale"), scale);
      gl.uniform1f(u("uPixel"), h / 900);
      gl.uniform3fv(u("uTint"), this.cur.tint);
      gl.uniform3fv(u("uWhite"), PALETTE.white);
      gl.uniform3fv(u("uSteel"), PALETTE.steel);
      gl.uniform4fv(u("uSub[0]"), this.subCores.flat());
      gl.drawArrays(mode, 0, count);
    }
  }

  // Minimal fallback: concentric breathing rings. Same palette and identity cue, no WebGL.
  #draw2D(nowMs) {
    const ctx = this.ctx2d;
    if (!ctx) return;
    const { width: w, height: h } = this.canvas;
    ctx.clearRect(0, 0, w, h);
    const cx = w / 2;
    const cy = h / 2;
    const base = Math.min(w, h) * 0.18 * (1 - 0.18 * this.cur.recede);
    const col = this.cur.tint.map((v) => Math.round(v * 255)).join(",");
    const pulse = this.reducedMotion ? 0 : Math.sin(nowMs / 1000 * 1.2) * 0.04;
    for (let i = 0; i < 4; i++) {
      const r = base * (0.5 + i * 0.4) * (1 + pulse) * this.assemble;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(${col},${(0.5 - i * 0.1) * (0.4 + this.cur.energy)})`;
      ctx.lineWidth = Math.max(1, w / 900);
      ctx.stroke();
    }
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, base * 0.6);
    g.addColorStop(0, `rgba(${col},${0.7 * this.assemble})`);
    g.addColorStop(1, `rgba(${col},0)`);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cx, cy, base * 0.6, 0, Math.PI * 2);
    ctx.fill();
  }
}

function link(gl, vsSrc, fsSrc) {
  const compile = (type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(`shader: ${gl.getShaderInfoLog(s)}`);
    return s;
  };
  const p = gl.createProgram();
  gl.attachShader(p, compile(gl.VERTEX_SHADER, vsSrc));
  gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fsSrc));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(`link: ${gl.getProgramInfoLog(p)}`);
  return p;
}
