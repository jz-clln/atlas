import { useEffect, useRef } from "react";
import * as THREE from "three";

export type OrbState = "idle" | "listening" | "thinking" | "speaking";

type Props = {
  state: OrbState;
  // Optional live mic level source — VoiceModeOverlay sets this once a
  // getUserMedia stream + AnalyserNode exist. When present, "listening"
  // reacts to real microphone volume instead of the simulated pattern.
  micRef?: React.MutableRefObject<{ analyser: AnalyserNode; dataArray: Uint8Array<ArrayBuffer> } | null>;
};

// Distinct per-state hues (inactive/listening/thinking/talking), closer to
// Apple/Alexa-style assistant conventions — inactive stays neutral, the
// other three each get their own color so the state is readable at a glance.
const COLORS = {
  idle: 0x48484c,
  listening: 0x4da3ff,
  thinking: 0xe8a33d,
  speaking: 0x34c979,
};

const STATE_CONFIG: Record<
  OrbState,
  {
    color: number;
    audioLevel: number;
    audioFrequency: number;
    timeSpeed: number;
    pulsate: boolean;
    pulsateMode?: "audio-reactive" | "thinking" | "cadence";
    pulsateMin: number;
    pulsateMax: number;
    chromaticAberration: number;
  }
> = {
  idle: {
    color: COLORS.idle,
    audioLevel: 0.15,
    audioFrequency: 0.2,
    timeSpeed: 0.015,
    pulsate: false,
    pulsateMin: 0,
    pulsateMax: 0,
    chromaticAberration: 0.15,
  },  listening: {
    color: COLORS.listening,
    audioLevel: 0.6,
    audioFrequency: 0.7,
    timeSpeed: 0.022,
    pulsate: true,
    pulsateMode: "audio-reactive",
    pulsateMin: 0.02,
    pulsateMax: 0.25,
    chromaticAberration: 0.3,
  },
  thinking: {
    color: COLORS.thinking,
    audioLevel: 0.45,
    audioFrequency: 0.5,
    timeSpeed: 0.02,
    pulsate: true,
    pulsateMode: "thinking",
    pulsateMin: 0.0,
    pulsateMax: 0.15,
    chromaticAberration: 0.18,
  },
  speaking: {
    color: COLORS.speaking,
    audioLevel: 0.8,
    audioFrequency: 0.9,
    timeSpeed: 0.027,
    pulsate: true,
    pulsateMode: "cadence",
    pulsateMin: 0.05,
    pulsateMax: 0.22,
    chromaticAberration: 0.35,
  },
};

const LAYER_SCALES = [1.0, 0.85, 0.7];
const LAYER_OPACITIES = [0.35, 0.4, 0.6];
const LAYER_ROTATION_SPEEDS = [
  { x: 0.001, y: 0.002, z: 0 },
  { x: -0.002, y: 0.003, z: 0.001 },
  { x: 0.003, y: -0.002, z: -0.001 },
];

const vertexShader = `
    varying vec3 vNormal;
    varying vec3 vPosition;

    uniform float time;
    uniform float audioLevel;
    uniform float layerOffset;

    vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
    vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
    vec4 permute(vec4 x) { return mod289(((x*34.0)+1.0)*x); }
    vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }

    float snoise(vec3 v) {
        const vec2 C = vec2(1.0/6.0, 1.0/3.0);
        const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
        vec3 i  = floor(v + dot(v, C.yyy));
        vec3 x0 = v - i + dot(i, C.xxx);
        vec3 g = step(x0.yzx, x0.xyz);
        vec3 l = 1.0 - g;
        vec3 i1 = min(g.xyz, l.zxy);
        vec3 i2 = max(g.xyz, l.zxy);
        vec3 x1 = x0 - i1 + C.xxx;
        vec3 x2 = x0 - i2 + C.yyy;
        vec3 x3 = x0 - D.yyy;
        i = mod289(i);
        vec4 p = permute(permute(permute(
            i.z + vec4(0.0, i1.z, i2.z, 1.0))
            + i.y + vec4(0.0, i1.y, i2.y, 1.0))
            + i.x + vec4(0.0, i1.x, i2.x, 1.0));
        float n_ = 0.142857142857;
        vec3 ns = n_ * D.wyz - D.xzx;
        vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
        vec4 x_ = floor(j * ns.z);
        vec4 y_ = floor(j - 7.0 * x_);
        vec4 x = x_ *ns.x + ns.yyyy;
        vec4 y = y_ *ns.x + ns.yyyy;
        vec4 h = 1.0 - abs(x) - abs(y);
        vec4 b0 = vec4(x.xy, y.xy);
        vec4 b1 = vec4(x.zw, y.zw);
        vec4 s0 = floor(b0)*2.0 + 1.0;
        vec4 s1 = floor(b1)*2.0 + 1.0;
        vec4 sh = -step(h, vec4(0.0));
        vec4 a0 = b0.xzyw + s0.xzyw*sh.xxyy;
        vec4 a1 = b1.xzyw + s1.xzyw*sh.zzww;
        vec3 p0 = vec3(a0.xy, h.x);
        vec3 p1 = vec3(a0.zw, h.y);
        vec3 p2 = vec3(a1.xy, h.z);
        vec3 p3 = vec3(a1.zw, h.w);
        vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2,p2), dot(p3,p3)));
        p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
        vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
        m = m * m;
        return 42.0 * dot(m*m, vec4(dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3)));
    }

    void main() {
        vNormal = normalize(normalMatrix * normal);
        vec3 pos = position;

        float wave1 = sin(pos.y * 2.5 + time * 1.5 + layerOffset) * cos(pos.x * 2.0 - time * 1.2);
        float wave2 = sin(pos.x * 3.0 - time * 1.8 + layerOffset) * cos(pos.z * 2.5 + time * 1.5);
        float wave3 = sin(pos.z * 2.8 + time * 1.6 + layerOffset) * cos(pos.y * 2.3 - time * 1.3);

        float noise1 = snoise(pos * 1.2 + time * 0.3 + layerOffset);
        float noise2 = snoise(pos * 2.0 - time * 0.2 + layerOffset * 0.5);

        float distortion = (wave1 + wave2 + wave3) * 0.008;
        distortion += (noise1 * 0.008 + noise2 * 0.007);
        distortion *= (0.3 + audioLevel * 0.6);

        pos = pos + normal * distortion;
        vPosition = pos;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
    }
`;

const fragmentShader = `
    varying vec3 vNormal;
    varying vec3 vPosition;

    uniform vec3 sphereColor;
    uniform float opacity;
    uniform float time;
    uniform float chromaticAberration;

    vec3 rgb2hsv(vec3 c) {
        vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
        vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
        vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
        float d = q.x - min(q.w, q.y);
        float e = 1.0e-10;
        return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
    }

    vec3 hsv2rgb(vec3 c) {
        vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
        vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
        return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
    }

    void main() {
        vec3 viewDirection = normalize(cameraPosition - vPosition);
        float fresnel = pow(1.0 - abs(dot(viewDirection, normalize(vNormal))), 2.0);

        vec3 normalWorld = normalize(vNormal);
        float rainbowShift = normalWorld.x * 0.5 + normalWorld.y * 0.2 + normalWorld.z * 0.1;
        rainbowShift += sin(vPosition.x * 5.0 + time * 0.5) * 0.01;
        rainbowShift += cos(vPosition.y * 4.0 - time * 0.3) * 0.01;
        rainbowShift = fract(rainbowShift);
        vec3 rainbow = hsv2rgb(vec3(rainbowShift, 0.8, 1.0));

        vec3 hsv = rgb2hsv(sphereColor);
        float aberrationAmount = chromaticAberration * fresnel;

        vec3 hsvR = hsv;
        hsvR.x = fract(hsv.x + aberrationAmount * 0.15);
        vec3 colorR = hsv2rgb(hsvR);
        vec3 colorG = sphereColor;
        vec3 hsvB = hsv;
        hsvB.x = fract(hsv.x - aberrationAmount * 0.15);
        vec3 colorB = hsv2rgb(hsvB);

        vec3 color = vec3(colorR.r, colorG.g, colorB.b);

        // Toned down from the original (0.6 mix) so the requested palette
        // stays dominant instead of being washed out by rainbow hues.
        float holographicIntensity = fresnel * 0.6 + 0.2;
        color = mix(color, rainbow, holographicIntensity * 0.15);
        color += fresnel * chromaticAberration * 0.08;

        float brightness = 1.0 + sin(vPosition.x * 3.0 + time) * 0.1;
        brightness += sin(vPosition.y * 2.5 - time * 0.8) * 0.1;
        float shimmer = sin(vPosition.x * 8.0 + vPosition.y * 6.0 + time * 2.0) * 0.04 + 0.96;
        brightness *= shimmer;
        color *= brightness;

        gl_FragColor = vec4(color, opacity);
    }
`;

export function AtlasVoiceOrb({ state, micRef }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef<OrbState>(state);
  const frameRef = useRef<number>();
  const cadenceRef = useRef({ time: 0, intensity: 0, nextChange: 0 });
  const demoRef = useRef({ time: 0, intensity: 0, nextChange: 0 });
  const scaleRef = useRef({ current: 1, target: 1 });

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(75, 1, 0.1, 1000);
    camera.position.z = 5;

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    const layers: THREE.Mesh[] = [];
    LAYER_SCALES.forEach((scale, index) => {
      const geometry = new THREE.SphereGeometry(scale, 64, 64);
      const material = new THREE.ShaderMaterial({
        vertexShader,
        fragmentShader,
        uniforms: {
          time: { value: 0 },
          audioLevel: { value: 0 },
          layerOffset: { value: index * 2.0 },
          sphereColor: { value: new THREE.Color(STATE_CONFIG.idle.color) },
          opacity: { value: LAYER_OPACITIES[index] },
          chromaticAberration: { value: STATE_CONFIG.idle.chromaticAberration },
        },
        transparent: true,
        side: THREE.DoubleSide,
        blending: THREE.NormalBlending,
        depthWrite: false,
      });
      const sphere = new THREE.Mesh(geometry, material);
      sphere.userData = { baseScale: scale, rotationSpeed: LAYER_ROTATION_SPEEDS[index] };
      scene.add(sphere);
      layers.push(sphere);
    });

    scene.add(new THREE.AmbientLight(0xffffff, 0.7));
    const light1 = new THREE.PointLight(0xbeb7a4, 0.8, 100);
    light1.position.set(5, 5, 5);
    scene.add(light1);
    const light2 = new THREE.PointLight(0x999999, 0.5, 100);
    light2.position.set(-5, -5, 5);
    scene.add(light2);

    function resize() {
      if (!container) return;
      const { width, height } = container.getBoundingClientRect();
      if (width === 0 || height === 0) return;
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height);
    }
    resize();
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(container);

    function animate() {
      frameRef.current = requestAnimationFrame(animate);

      const cfg = STATE_CONFIG[stateRef.current];
      let audioLevel = cfg.audioLevel;

      const mic = micRef?.current;
      if (stateRef.current === "listening" && mic) {
        mic.analyser.getByteFrequencyData(mic.dataArray);
        let sum = 0;
        for (let i = 0; i < mic.dataArray.length; i++) sum += mic.dataArray[i];
        audioLevel = sum / mic.dataArray.length / 255;
      }

      if (cfg.pulsate) {
        let volume: number;
        if (cfg.pulsateMode === "audio-reactive") {
          if (mic) {
            volume = Math.min(1.0, audioLevel * 2.5);
            if (volume < 0.1) volume *= 2;
          } else {
            volume = updateDemoPattern(demoRef.current);
          }
        } else if (cfg.pulsateMode === "thinking") {
          const t = Date.now() * 0.001;
          volume = (Math.sin(t * 1.5) + 1.0) / 2.0;
        } else {
          volume = updateCadence(cadenceRef.current);
        }
        scaleRef.current.target = 1.0 + cfg.pulsateMin + volume * (cfg.pulsateMax - cfg.pulsateMin);
      } else {
        scaleRef.current.target = 1.0;
      }

      const smoothing = mic && cfg.pulsateMode === "audio-reactive" ? 0.25 : 0.12;
      scaleRef.current.current += (scaleRef.current.target - scaleRef.current.current) * smoothing;

      layers.forEach((layer) => {
        const material = layer.material as THREE.ShaderMaterial;
        material.uniforms.time.value += cfg.timeSpeed;
        material.uniforms.audioLevel.value = audioLevel;
        material.uniforms.sphereColor.value.setHex(cfg.color);
        material.uniforms.chromaticAberration.value = cfg.chromaticAberration;

        const rot = layer.userData.rotationSpeed;
        layer.rotation.x += rot.x;
        layer.rotation.y += rot.y;
        layer.rotation.z += rot.z;

        const s = layer.userData.baseScale * scaleRef.current.current;
        layer.scale.set(s, s, s);
      });

      renderer.render(scene, camera);
    }
    animate();

    return () => {
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
      resizeObserver.disconnect();
      layers.forEach((layer) => {
        layer.geometry.dispose();
        (layer.material as THREE.ShaderMaterial).dispose();
      });
      renderer.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div ref={containerRef} className="h-full w-full">
      <canvas ref={canvasRef} className="h-full w-full" />
    </div>
  );
}

function updateDemoPattern(demo: { time: number; intensity: number; nextChange: number }): number {
  const now = Date.now() * 0.001;
  if (now >= demo.nextChange) {
    const r = Math.random();
    if (r < 0.25) {
      demo.intensity = 0.5 + Math.random() * 0.3;
      demo.nextChange = now + 0.1 + Math.random() * 0.1;
    } else if (r < 0.5) {
      demo.intensity = 0.6 + Math.random() * 0.3;
      demo.nextChange = now + 0.2 + Math.random() * 0.2;
    } else if (r < 0.75) {
      demo.intensity = 0.7 + Math.random() * 0.3;
      demo.nextChange = now + 0.15 + Math.random() * 0.25;
    } else if (r < 0.9) {
      demo.intensity = 0.4 + Math.random() * 0.4;
      demo.nextChange = now + 0.3 + Math.random() * 0.3;
    } else {
      demo.intensity = 0.05 + Math.random() * 0.1;
      demo.nextChange = now + 0.1 + Math.random() * 0.15;
    }
  }
  const fluctuation = Math.sin(now * 8.0) * 0.1;
  return Math.max(0, demo.intensity + fluctuation);
}

function updateCadence(cadence: { time: number; intensity: number; nextChange: number }): number {
  const now = Date.now() * 0.001;
  if (now >= cadence.nextChange) {
    const r = Math.random();
    if (r < 0.3) {
      cadence.intensity = 0.7 + Math.random() * 0.3;
      cadence.nextChange = now + 0.15 + Math.random() * 0.15;
    } else if (r < 0.6) {
      cadence.intensity = 0.5 + Math.random() * 0.4;
      cadence.nextChange = now + 0.3 + Math.random() * 0.3;
    } else if (r < 0.85) {
      cadence.intensity = 0.6 + Math.random() * 0.4;
      cadence.nextChange = now + 0.5 + Math.random() * 0.4;
    } else {
      cadence.intensity = 0.1 + Math.random() * 0.2;
      cadence.nextChange = now + 0.2 + Math.random() * 0.3;
    }
  }
  const fluctuation = Math.sin(now * 10.0) * 0.08;
  return Math.max(0, cadence.intensity + fluctuation);
}