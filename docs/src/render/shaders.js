// GLSL ES 3.00 shaders. The nucleus is built from light: additive points/lines,
// no solid surfaces. Motion is organic (noise-displaced radii), not symmetric.

const COMMON = `#version 300 es
precision highp float;
uniform mat4 uViewProj;
uniform float uTime, uEnergy, uComplexity, uPulse, uAssemble, uRecede, uScale, uPixel;
uniform vec3 uTint, uWhite, uSteel;
uniform vec4 uSub[4];
in vec3 aDir;
in vec3 aMeta; // layer, seedA, seedB
out vec4 vColor;

float hash(float n){ return fract(sin(n*127.1)*43758.5453); }
float noise3(vec3 p){
  vec3 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
  float n=i.x+i.y*57.0+i.z*113.0;
  return mix(mix(mix(hash(n),hash(n+1.0),f.x),mix(hash(n+57.0),hash(n+58.0),f.x),f.y),
             mix(mix(hash(n+113.0),hash(n+114.0),f.x),mix(hash(n+170.0),hash(n+171.0),f.x),f.y),f.z);
}
float ease(float t){ return t*t*(3.0-2.0*t); }

vec3 place(out float bright, out float size){
  float layer = aMeta.x;
  float sa = aMeta.y, sb = aMeta.z;
  float organic = noise3(aDir*1.7 + uTime*0.12*(0.4+uComplexity));
  float breathe = 1.0 + uPulse;
  vec3 p; bright = 0.5; size = 1.5;
  if (layer < 0.5) { // dense nucleus
    float r = (0.18 + 0.34*sa*sa) * (0.8 + 0.5*organic) * breathe;
    p = aDir * r; bright = 0.62 - r*0.6; size = 1.6 + 1.6*(1.0-sa);
  } else if (layer < 3.5) { // shells (complexify with load)
    float shell = 0.5 + layer*0.2 + 0.07*uComplexity*layer;
    float r = shell * (0.85 + 0.35*organic) * (1.0 + 0.5*uPulse);
    float ang = uTime*0.05*layer*(0.5+uEnergy);
    float c = cos(ang), s = sin(ang);
    p = vec3(aDir.x*c - aDir.z*s, aDir.y, aDir.x*s + aDir.z*c) * r;
    bright = 0.7 + 0.35*uEnergy; size = 2.0;
  } else if (layer < 4.5) { // neurological impulses travelling outward
    float t = fract(uTime*(0.12 + 0.5*uEnergy)*(0.6+sa) + sb);
    float r = mix(0.2, 1.1 + 0.3*uComplexity, t);
    p = aDir * r * (0.9 + 0.2*organic);
    float vis = step(sa, 0.15 + 0.85*uEnergy);
    bright = vis * sin(t*3.14159) * (0.8 + 1.0*uEnergy); size = 3.0;
  } else { // temporary sub-cores branching from the nucleus
    int idx = int(clamp(floor(sb), 0.0, 3.0));
    vec4 sc = uSub[idx];
    p = sc.xyz + aDir * (0.12 + 0.1*sa) * sc.w;
    bright = sc.w * 0.8; size = 1.6;
  }
  // cinematic assembly: particles converge from scattered space with per-particle delay
  float delay = hash(sa*91.7 + sb*13.3)*0.5;
  float k = ease(clamp((uAssemble - delay)/0.5, 0.0, 1.0));
  vec3 scatter = normalize(vec3(hash(sa*3.1)-0.5, hash(sb*7.7)-0.5, hash(sa*5.3+sb)-0.5)) * (2.5 + 2.0*hash(sa+sb));
  p = mix(scatter, p, k);
  bright *= k;
  return p * uScale;
}
`;

export const POINT_VS = `${COMMON}
void main(){
  float bright, size;
  vec3 p = place(bright, size);
  vec4 pos = uViewProj * vec4(p, 1.0);
  gl_Position = pos;
  gl_PointSize = max(1.5, size * uPixel * 16.0 / max(0.5, pos.w));
  float depth = clamp(1.3 - pos.w/7.0, 0.45, 1.0);
  vec3 col = mix(uSteel, uTint, clamp(bright*1.3,0.0,1.0));
  col = mix(col, uWhite, clamp((bright-0.7)*2.0,0.0,0.6));
  vColor = vec4(col, clamp(bright*1.6,0.0,1.0) * depth * (1.0 - 0.6*uRecede));
}`;

export const POINT_FS = `#version 300 es
precision mediump float;
in vec4 vColor;
out vec4 o;
void main(){
  vec2 c = gl_PointCoord*2.0-1.0;
  float d = dot(c,c);
  if (d > 1.0) discard;
  float a = (1.0-d); a *= a;
  o = vec4(vColor.rgb, vColor.a * a);
}`;

export const LINE_VS = `${COMMON}
void main(){
  float bright, size;
  vec3 p = place(bright, size);
  vec4 pos = uViewProj * vec4(p, 1.0);
  gl_Position = pos;
  float depth = clamp(1.3 - pos.w/7.0, 0.3, 1.0);
  vColor = vec4(mix(uSteel, uTint, 0.8), 0.55 * depth * (0.5 + 0.8*uComplexity + 0.5*uEnergy) * uAssemble * (1.0 - 0.6*uRecede));
}`;

export const LINE_FS = `#version 300 es
precision mediump float;
in vec4 vColor;
out vec4 o;
void main(){ o = vColor; }`;
