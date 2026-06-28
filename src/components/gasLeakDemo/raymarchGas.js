import * as THREE from 'three'

/**
 * 为矿道瓦斯 demo 创建一个基于 ShaderMaterial 的 Raymarch 体渲染网格。
 * 不依赖 3D 纹理，直接在 fragment shader 中用程序化噪声 + 裂缝源点生成密度场，
 * 并用巷道 SDF 限制气体不穿透岩壁/顶棚。
 * 该版本强调：缝隙渗出、湍流扩散、时间脉动、沿巷道飘移，
 * 并通过 box 内缩 + 每像素步进抖动消除闪烁/摩尔纹。
 */
export function createTunnelRaymarchGas(crackPositions, tunnelParams, options = {}) {
  const {
    width = tunnelParams.width,
    height = tunnelParams.height,
    length = tunnelParams.length * 0.8,
    steps = 80,
    opacityScale = 2.4,
    boxInset = 0.18,
  } = options

  // 让 volume box 比巷道内轮廓整体内缩一点，避免 box 面与巷壁/顶棚共面产生 z-fighting
  const boxWidth = Math.max(0.5, width - boxInset * 2.0)
  const boxHeight = Math.max(0.5, height - boxInset * 2.0)
  const boxLength = length

  // 将裂缝位置转换到局部空间（以 volume box 中心为原点，范围 [-0.5, 0.5]）
  const localCracks = crackPositions.map((p) => new THREE.Vector3(
    p.x / boxLength,
    p.y / boxHeight,
    p.z / boxWidth,
  ))
  while (localCracks.length < 12) {
    localCracks.push(new THREE.Vector3(0.0, 0.0, 0.0))
  }

  const geometry = new THREE.BoxGeometry(1, 1, 1)
  const material = new THREE.ShaderMaterial({
    transparent: true,
    side: THREE.BackSide,
    depthWrite: false,
    glslVersion: THREE.GLSL3,
    uniforms: {
      uTime: { value: 0 },
      uLeakTime: { value: 0 },
      uSteps: { value: steps },
      uOpacityScale: { value: opacityScale },
      uModelInv: { value: new THREE.Matrix4() },
      uCrackCount: { value: Math.min(localCracks.length, 12) },
      uCrackPositions: { value: localCracks },
      uTunnelHalfSize: { value: new THREE.Vector3(boxLength / 2, boxHeight / 2, boxWidth / 2) },
      uGasColor: { value: new THREE.Color('#4a7a63') },
      uEmissionColor: { value: new THREE.Color('#d8f5e8') },
    },
    vertexShader: `
      out vec3 vLocalPos;
      void main() {
        vLocalPos = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      precision highp float;

      uniform float uTime;
      uniform float uLeakTime;
      uniform float uSteps;
      uniform float uOpacityScale;
      uniform mat4 uModelInv;
      uniform int uCrackCount;
      uniform vec3 uCrackPositions[12];
      uniform vec3 uTunnelHalfSize;
      uniform vec3 uGasColor;
      uniform vec3 uEmissionColor;

      in vec3 vLocalPos;
      out vec4 out_FragColor;

      const int MAX_STEPS = 96;

      // 2D 哈希，用于每像素步进抖动
      float hash21(vec2 p) {
        return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
      }

      vec2 hitBox(vec3 origin, vec3 dir) {
        vec3 boxMin = vec3(-0.5);
        vec3 boxMax = vec3(0.5);
        vec3 invDir = 1.0 / dir;
        vec3 tMinTmp = (boxMin - origin) * invDir;
        vec3 tMaxTmp = (boxMax - origin) * invDir;
        vec3 tMin = min(tMinTmp, tMaxTmp);
        vec3 tMax = max(tMinTmp, tMaxTmp);
        float t0 = max(max(tMin.x, tMin.y), tMin.z);
        float t1 = min(min(tMax.x, tMax.y), tMax.z);
        return vec2(t0, t1);
      }

      // 3D 哈希噪声
      float hash31(vec3 p) {
        p = vec3(dot(p, vec3(127.1, 311.7, 74.7)),
                 dot(p, vec3(269.5, 183.3, 246.1)),
                 dot(p, vec3(113.5, 271.9, 124.6)));
        return fract(sin(p.x + p.y + p.z) * 43758.5453);
      }

      float noise3(vec3 p) {
        vec3 i = floor(p);
        vec3 f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        float n = mix(
          mix(
            mix(hash31(i + vec3(0,0,0)), hash31(i + vec3(1,0,0)), f.x),
            mix(hash31(i + vec3(0,1,0)), hash31(i + vec3(1,1,0)), f.x),
            f.y
          ),
          mix(
            mix(hash31(i + vec3(0,0,1)), hash31(i + vec3(1,0,1)), f.x),
            mix(hash31(i + vec3(0,1,1)), hash31(i + vec3(1,1,1)), f.x),
            f.y
          ),
          f.z
        );
        return n;
      }

      // 分形布朗运动：4 层八度湍流
      float fbm(vec3 p) {
        float v = 0.0;
        float a = 0.5;
        vec3 shift = vec3(31.1, 17.3, 23.7);
        for (int i = 0; i < 4; i++) {
          v += a * noise3(p);
          p = p * 2.1 + shift;
          a *= 0.5;
        }
        return v;
      }

      // 巷道 SDF：圆角矩形截面沿 X 拉伸
      float tunnelSDF(vec3 p) {
        vec3 halfSize = uTunnelHalfSize;
        vec3 worldP = p * halfSize * 2.0;
        float roundRadius = 0.7;
        vec2 d = abs(worldP.yz) - vec2(halfSize.y - roundRadius, halfSize.z - roundRadius);
        float crossDist = length(max(d, 0.0)) + min(max(d.x, d.y), 0.0) - roundRadius;
        return crossDist;
      }

      // 气体密度场：从缝隙源点渗出，随泄漏时间扩散（√t 标度）、脉动、飘移
      float gasDensity(vec3 p) {
        float leakT = max(uLeakTime, 0.0);
        // 扩散半径随时间按 sqrt(t) 增长，初始极小，缓慢扩大
        float diffusionRadius = 0.015 + 0.02 * sqrt(leakT);
        // 源点强度随时间缓慢衰减（质量守恒：云团变大则中心变稀）
        float sourceStrength = 1.0 / (1.0 + 0.05 * leakT);
        // 整体涌现强度：8 秒内从 0 到 1，确保肉眼能看到从无到有的过程
        float emerge = smoothstep(0.0, 8.0, leakT);

        // 沿巷道向入口（-X）和顶棚（+Y）的缓慢飘移
        vec3 drift = vec3(-0.12, 0.045, 0.0) * uTime;
        // 湍流扭曲
        vec3 turb = vec3(
          fbm(p * 1.8 + vec3(uTime * 0.05, uTime * 0.08, 0.0)),
          fbm(p * 1.7 + vec3(0.0, uTime * 0.06, uTime * 0.04)),
          fbm(p * 1.6 + vec3(uTime * 0.04, 0.0, uTime * 0.07))
        );
        vec3 flowP = p + drift * 0.08 + (turb - 0.5) * 0.06;

        float d = 0.0;
        for (int i = 0; i < 12; i++) {
          if (i >= uCrackCount) break;
          vec3 cp = uCrackPositions[i];
          // 每个源点独立脉动，模拟瓦斯间歇性涌出
          float phase = float(i) * 1.31 + cp.x * 4.7;
          float pulse = 0.65 + 0.35 * sin(uTime * 1.6 + phase);

          vec3 diff = flowP - cp;
          // 沿 X 方向拉伸，模拟泄漏后沿巷道扩散
          diff.x *= 0.78;
          float dist = length(diff);

          // 扩散核：高斯 blob，半径随泄漏时间增长（核心扩散过程）
          float nd = dist / diffusionRadius;
          float blob = exp(-nd * nd * 2.5) * sourceStrength * pulse;
          // 远距离湍流尾巴，半径也随扩散时间增长，且受涌现强度调制
          float tailRadius = max(diffusionRadius * 2.5, 0.05);
          float tail = exp(-dist / tailRadius) * (0.15 + 0.25 * turb.x) * 0.5 * emerge;
          d += (blob + tail) * emerge;
        }
        d = clamp(d, 0.0, 1.2);

        // 整体湍流调制，让云团边缘不断变化
        float detail = fbm(p * 3.5 + vec3(uTime * 0.06, uTime * 0.09, uTime * 0.05));
        d *= (0.55 + 0.55 * detail);

        return clamp(d, 0.0, 1.0);
      }

      void main() {
        vec3 rayOrigin = (uModelInv * vec4(cameraPosition, 1.0)).xyz;
        vec3 rayDir = normalize(vLocalPos - rayOrigin);
        vec2 bounds = hitBox(rayOrigin, rayDir);
        if (bounds.x > bounds.y) discard;

        float t0 = max(bounds.x, 0.0);
        float t1 = bounds.y;

        vec4 accum = vec4(0.0);
        float stepCount = min(uSteps, float(MAX_STEPS));
        float dt = (t1 - t0) / max(stepCount, 1.0);

        // 每像素蓝噪声偏移，破除固定步进产生的摩尔纹/条带
        float jitter = hash21(gl_FragCoord.xy * 0.371 + uTime * 0.013) - 0.5;

        for (int i = 0; i < MAX_STEPS; i++) {
          if (float(i) >= stepCount) break;
          float t = t0 + dt * (float(i) + 0.5 + jitter);
          vec3 p = rayOrigin + rayDir * t;

          float tunnelDist = tunnelSDF(p);
          if (tunnelDist > 0.0) continue;

          // 边界过渡，靠近岩壁更稀薄
          float boundaryFactor = smoothstep(0.0, 0.42, -tunnelDist);

          float raw = gasDensity(p) * boundaryFactor;
          if (raw < 0.002) continue;

          // 低密度偏灰青，高密度偏亮白绿（更“气体”感）
          float density = pow(raw, 1.25) * 0.7;
          vec3 color = mix(uGasColor, uEmissionColor, pow(density, 1.4));
          color *= (0.8 + 0.75 * density);
          float alphaStep = (1.0 - exp(-density * uOpacityScale * dt * 28.0));

          accum.rgb += (1.0 - accum.a) * alphaStep * color;
          accum.a += (1.0 - accum.a) * alphaStep;
          if (accum.a > 0.985) break;
        }

        if (accum.a < 0.003) discard;
        out_FragColor = vec4(accum.rgb, accum.a);
      }
    `,
  })

  const mesh = new THREE.Mesh(geometry, material)
  mesh.scale.set(boxLength, boxHeight, boxWidth)
  mesh.position.set(0, 0, 0)
  mesh.updateMatrixWorld(true)
  material.uniforms.uModelInv.value.copy(mesh.matrixWorld).invert()

  mesh.userData.leakActive = false

  return mesh
}

export function startRaymarchLeak(mesh) {
  if (!mesh?.userData) return
  mesh.userData.leakActive = true
}

export function resetRaymarchGas(mesh) {
  if (!mesh?.material?.uniforms) return
  if (mesh.material.uniforms.uLeakTime) {
    mesh.material.uniforms.uLeakTime.value = 0
  }
  if (mesh.userData) mesh.userData.leakActive = false
}

export function updateRaymarchGas(mesh, elapsed, delta = 0) {
  const u = mesh?.material?.uniforms
  if (!u) return
  if (u.uTime) u.uTime.value = elapsed
  if (mesh.userData?.leakActive && u.uLeakTime) {
    u.uLeakTime.value = (u.uLeakTime.value || 0) + Math.min(delta, 0.05)
  }
}
