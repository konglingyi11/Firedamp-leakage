/** 二维波纹 + 线段障碍一阶反射（UV 空间 [0,1]²） */

export const RADAR_PLANE_WAVE_VERTEX_SHADER = `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`

export const RADAR_PLANE_WAVE_FRAGMENT_SHADER = `
precision highp float;

varying vec2 vUv;

uniform float uRadarWaveTime;
uniform vec2 uSource;
uniform vec4 uLines[8];
uniform int uLineCount;

const float SPEED = 0.42;
const float BAND = 0.022;
const float ATTEN = 7.0;
const float REFLECT_SCALE = 0.72;

vec2 reflectPointAcrossLine(vec2 p, vec2 a, vec2 b) {
  vec2 ab = b - a;
  float h = dot(ab, ab);
  if (h < 1e-8) return p;
  vec2 n = vec2(-ab.y, ab.x) / sqrt(h);
  return p - 2.0 * dot(p - a, n) * n;
}

vec2 orientNormalTowardSource(vec2 a, vec2 b, vec2 source) {
  vec2 ab = b - a;
  float h = dot(ab, ab);
  vec2 n = vec2(-ab.y, ab.x) / sqrt(h);
  if (dot(source - a, n) < 0.0) n = -n;
  return n;
}

float cross2(vec2 a, vec2 b) {
  return a.x * b.y - a.y * b.x;
}

float segmentHit(vec2 p0, vec2 p1, vec2 a, vec2 b) {
  vec2 r = p1 - p0;
  vec2 s = b - a;
  float den = cross2(r, s);
  if (abs(den) < 1e-6) return 0.0;

  vec2 ap = a - p0;
  float t = cross2(ap, s) / den;
  float u = cross2(ap, r) / den;
  return step(0.001, t) * step(t, 0.999) * step(-0.001, u) * step(u, 1.001);
}

float ringBand(vec2 uv, vec2 center, float t) {
  float d = distance(uv, center);
  float r = t * SPEED;
  float delta = d - r;
  float shell = exp(-(delta * delta) / (BAND * BAND));
  return shell * exp(-d * ATTEN * 0.012);
}

void main() {
  vec2 uv = vUv;
  float t = mod(uRadarWaveTime, 2.45);
  float directMask = 1.0;

  for (int i = 0; i < 8; i++) {
    if (i >= uLineCount) break;
    vec4 L = uLines[i];
    directMask *= mix(1.0, 0.12, segmentHit(uSource, uv, L.xy, L.zw));
  }

  float c = ringBand(uv, uSource, t) * directMask;

  for (int i = 0; i < 8; i++) {
    if (i >= uLineCount) break;

    vec4 L = uLines[i];
    vec2 a = L.xy;
    vec2 b = L.zw;

    vec2 ab = b - a;
    if (dot(ab, ab) < 1e-8) continue;

    vec2 n = orientNormalTowardSource(a, b, uSource);
    if (dot(uv - a, n) <= 0.0) continue;

    vec2 sp = reflectPointAcrossLine(uSource, a, b);
    float reflectedPath = segmentHit(sp, uv, a, b);
    c += ringBand(uv, sp, t) * REFLECT_SCALE * reflectedPath;
  }

  vec3 base = mix(vec3(0.02, 0.07, 0.12), vec3(0.05, 0.85, 1.0), clamp(c * 1.15, 0.0, 1.0));
  float glow = clamp(c * 2.0, 0.0, 1.0);
  vec3 col = base + vec3(0.35, 0.9, 1.0) * glow * 0.4;
  gl_FragColor = vec4(col, 0.92);
}
`
