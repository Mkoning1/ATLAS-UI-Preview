// Cinematic auto-camera with manual inspection. Pure math, testable.

export class CameraController {
  constructor({ reducedMotion = false, resumeAfterMs = 6000 } = {}) {
    this.reducedMotion = reducedMotion;
    this.resumeAfterMs = resumeAfterMs;
    this.yaw = 0.4;
    this.pitch = 0.18;
    this.distance = 4.2;
    this.manualUntil = 0;
  }

  /** Manual rotate (radians). Pauses the cinematic drift for `resumeAfterMs`. */
  drag(dYaw, dPitch, nowMs) {
    this.yaw += dYaw;
    this.pitch = Math.max(-1.2, Math.min(1.2, this.pitch + dPitch));
    this.manualUntil = nowMs + this.resumeAfterMs;
  }

  zoom(delta, nowMs) {
    this.distance = Math.max(2.4, Math.min(8, this.distance + delta));
    this.manualUntil = nowMs + this.resumeAfterMs;
  }

  /** Advance by dt seconds at time nowMs. Automatic drift is off in reduced-motion. */
  update(dt, nowMs) {
    if (this.reducedMotion || nowMs < this.manualUntil) return;
    this.yaw += dt * 0.07;
    this.pitch += (0.18 + Math.sin(nowMs / 9000) * 0.12 - this.pitch) * Math.min(1, dt * 0.5);
  }

  /** Camera eye position looking at the origin. */
  eye() {
    const cp = Math.cos(this.pitch);
    return [Math.sin(this.yaw) * cp * this.distance, Math.sin(this.pitch) * this.distance, Math.cos(this.yaw) * cp * this.distance];
  }
}

export function perspective(fovy, aspect, near, far) {
  const f = 1 / Math.tan(fovy / 2);
  const nf = 1 / (near - far);
  return [f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * nf, 0];
}

export function lookAt(eye, target = [0, 0, 0], up = [0, 1, 0]) {
  const z = norm(sub(eye, target));
  const x = norm(cross(up, z));
  const y = cross(z, x);
  return [x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, -dot(x, eye), -dot(y, eye), -dot(z, eye), 1];
}

export function multiply(a, b) {
  const o = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return o;
}

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
