import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import GUI from "lil-gui";
import AudioFFT from "../audio/audio-fft.js";
import { isEnabled } from "../config/feature-flags.js";
import appConfig from "../config/app-config.js";
import {
  BUILD_ID,
  BUILD_TIME,
  GIT_SHA,
  RUN_NUMBER,
} from "../config/build-info.js";
import {
  initializeGoogleAuth,
  requestGoogleAuth,
  showGoogleDrivePicker,
  getAccessToken,
} from "../google/google-auth.js";
import GoogleDriveAudioProvider from "../google/google-drive-audio.js";
import PyramidField from "../pyramid/pyramid-field.js";
import SolarSystem from "./solar-system.js";
import CameraController from "./camera-controller.js";
import AudioManager from "./audio-manager.js";
import Comet from "./comet.js";
import BeatDetector from "../audio/beat-detector.js";
import {
  computeSmoothedPlanetScale,
} from "./planet-pulse.js";
import { attachPlanetInteriorGoop } from "./planet-goop-material.js";
import { mountScreenDials } from "../ui/screen-dials.js";

function logNxgrxvityBuildStamp() {
  if (typeof console === "undefined" || !console.log) return;
  if (GIT_SHA) {
    console.log(
      `[NXGRXVITY] build ${BUILD_ID} · ${BUILD_TIME} · ${GIT_SHA.slice(0, 7)} · run #${RUN_NUMBER}`
    );
    return;
  }
  const host = typeof location !== "undefined" ? location.hostname : "";
  const isLocalDev =
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "[::1]";
  if (isLocalDev) {
    console.log(`[NXGRXVITY] dev (${BUILD_ID}) — not a CI deploy`);
  } else {
    console.log(
      "[NXGRXVITY] production (CI stamp missing in bundle; redeploy from Actions or hard-refresh)"
    );
  }
}
logNxgrxvityBuildStamp();

async function cleanupDevServiceWorkers() {
  if (typeof window === "undefined") return;
  if (!window.isSecureContext || !navigator.serviceWorker) return;
  if (window.location.hostname !== "localhost") return;

  try {
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(registrations.map((reg) => reg.unregister()));

    if (window.caches && typeof window.caches.keys === "function") {
      const keys = await window.caches.keys();
      await Promise.all(keys.map((key) => window.caches.delete(key)));
    }
  } catch (err) {
    console.warn("Failed to cleanup local service workers:", err);
  }
}

// helper utilities -------------------------------------------------------

/**
 * Detect whether the current environment should be treated as mobile.
 *
 * @returns {boolean} true if touch support or mobile user-agent is present
 */
function detectMobile() {
  return (
    "ontouchstart" in window ||
    navigator.maxTouchPoints > 0 ||
    /Mobi|Android/i.test(navigator.userAgent)
  );
}

/**
 * Create a perspective camera sized to the container element.
 *
 * @param {HTMLElement} container - DOM element that holds the canvas. Used for aspect ratio.
 * @returns {THREE.PerspectiveCamera} positioned camera ready for the scene
 */
function createCamera(container) {
  const cam = new THREE.PerspectiveCamera(
    45,
    container.clientWidth / container.clientHeight,
    0.1,
    2000
  );
  cam.position.set(0, 80, 300);
  return cam;
}

/**
 * Initialize a WebGL renderer and append its canvas to the container.
 *
 * @param {HTMLElement} container - parent element for the renderer.domElement
 * @returns {THREE.WebGLRenderer} initialized renderer
 */
function createRenderer(container) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  renderer.setSize(container.clientWidth, container.clientHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputEncoding = THREE.sRGBEncoding;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  container.appendChild(renderer.domElement);
  return renderer;
}

/**
 * Configure postprocessing stack: a render pass plus bloom.
 *
 * @param {THREE.WebGLRenderer} renderer - the renderer to wrap
 * @param {THREE.Scene} scene - scene for rendering
 * @param {THREE.Camera} camera - camera to render from
 * @param {HTMLElement} container - used for output resolution
 * @returns {{composer: EffectComposer, bloomPass: UnrealBloomPass}}
 */
function setupPostProcessing(renderer, scene, camera, container) {
  const composer = new EffectComposer(renderer);
  const renderPass = new RenderPass(scene, camera);
  composer.addPass(renderPass);
  composer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  const bloom = new UnrealBloomPass(
    new THREE.Vector2(container.clientWidth, container.clientHeight),
    0.9,
    0.4,
    0.85
  );
  bloom.threshold = 0.2;
  bloom.strength = 0.8;
  bloom.radius = 0.6;
  composer.addPass(bloom);
  return { composer, bloomPass: bloom };
}

/**
 * Build the planet mesh and return its material for later tweaking.
 *
 * @param {boolean} isMobile - reduces segments for performance on phones
 * @returns {{sphere: THREE.Mesh, material: THREE.Material}}
 */
function createSphere(isMobile) {
  const segs = isMobile ? 32 : 64;
  const geo = new THREE.SphereGeometry(0.9, segs, segs);
  const mat = new THREE.MeshPhysicalMaterial({
    color: 0x60a5fa,
    metalness: 0.2,
    roughness: 0.7,
    clearcoat: 0.5,
    clearcoatRoughness: 0.1,
    reflectivity: 0.9,
  });
  mat.userData.planetBaseColor = mat.color.clone();
  return { sphere: new THREE.Mesh(geo, mat), material: mat };
}

/**
 * Generate a point cloud of stars around the scene.
 *
 * @param {boolean} isMobile - fewer stars on mobile for perf
 * @returns {THREE.Points} starfield object
 */
function createStars(isMobile) {
  const starsGeo = new THREE.BufferGeometry();
  const count = isMobile ? 1200 : 3000;
  const pos = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const r = 200 + Math.random() * 600;
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(Math.random() * 2 - 1);
    pos[i * 3] = r * Math.sin(phi) * Math.cos(theta);
    pos[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
    pos[i * 3 + 2] = r * Math.cos(phi);
  }
  starsGeo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  const starsMat = new THREE.PointsMaterial({
    color: 0xffffff,
    size: 0.6,
    sizeAttenuation: true,
    depthWrite: false,
    transparent: true,
    opacity: 0.9,
  });
  return new THREE.Points(starsGeo, starsMat);
}

/**
 * Add all lighting sources to the scene.
 *
 * @param {THREE.Scene} scene - scene to populate
 */
function createSun(isMobile) {
  const segs = isMobile ? 24 : 48;
  const geo = new THREE.SphereGeometry(3, segs, segs);
  const mat = new THREE.MeshBasicMaterial({
    color: 0xffcc33,
  });
  const sun = new THREE.Mesh(geo, mat);
  sun.layers.enable(1); // bloom layer
  return sun;
}

const PLANET_DEFS = [
  { color: 0x60a5fa, radius: 0.9, orbit: 12, speed: 0.3,  label: "Blue"   },
  { color: 0xf87171, radius: 0.6, orbit: 20, speed: 0.2,  label: "Red"    },
  { color: 0x4ade80, radius: 1.1, orbit: 30, speed: 0.12, label: "Green"  },
  { color: 0xfbbf24, radius: 0.5, orbit: 40, speed: 0.08, label: "Gold"   },
  { color: 0xa78bfa, radius: 0.75, orbit: 52, speed: 0.05, label: "Violet" },
];

function createPlanet(def, isMobile) {
  const segs = isMobile ? 32 : 64;
  const geo = new THREE.SphereGeometry(def.radius, segs, segs);
  const mat = new THREE.MeshPhysicalMaterial({
    color: def.color,
    metalness: 0.2,
    roughness: 0.7,
    clearcoat: 0.5,
    clearcoatRoughness: 0.1,
    reflectivity: 0.9,
  });
  const mesh = new THREE.Mesh(geo, mat);
  const goopMaterial = attachPlanetInteriorGoop(mesh, def, isMobile);
  // Orbit pivot — planet is offset along +X, pivot rotates around Y
  const pivot = new THREE.Group();
  mesh.position.set(def.orbit, 0, 0);
  pivot.add(mesh);
  // Random starting angle so planets aren't all aligned
  pivot.rotation.y = Math.random() * Math.PI * 2;
  return { mesh, material: mat, pivot, def, goopMaterial };
}

function setupLights(scene) {
  // Sun light emanates from centre
  const sunLight = new THREE.PointLight(0xfff3d6, 3, 300, 0.6);
  sunLight.position.set(0, 0, 0);
  scene.add(sunLight);
  scene.add(new THREE.AmbientLight(0x6b6f88, 0.25));
  scene.add(new THREE.HemisphereLight(0xddeeff, 0x101020, 0.2));
  return sunLight;
}

/**
 * Build the GUI controller window for runtime parameter tweaking.
 *
 * @param {THREE.Material} material - planet material to adjust
 * @param {{ radius: number }} planetParams - live radius display (synced with audio)
 * @param {THREE.Mesh} sphere - primary planet mesh (scaled by radius)
 * @param {number} baseRadius - mesh radius before scale
 */
function setupGUI(material, planetParams, sphere, baseRadius) {
  const gui = new GUI({ closeFolders: true, autoPlace: false });
  gui.close();
  const planet = gui.addFolder("Planet");
  const colorCtrl = planet.addColor(material, "color");
  colorCtrl.onChange(() => {
    if (material.userData.planetBaseColor) {
      material.userData.planetBaseColor.copy(material.color);
    }
  });
  const radiusCtrl = planet.add(planetParams, "radius", 0.2, 2);
  radiusCtrl.onChange((v) => sphere.scale.setScalar(v / baseRadius));
  return { gui, radiusCtrl };
}

/**
 * Build the Camera GUI folder for start-distance and zoom controls.
 *
 * @param {GUI} gui - parent GUI instance
 * @param {object} state - interaction state with startDistance / zoomActive
 * @param {THREE.Camera} camera - camera to reposition on slider change
 */
function setupTitleGUI(gui) {
  const el = document.querySelector('.site-title');
  if (!el) return;

  const params = {
    shimmerSpeed: 4,
    glintSpeed: 3,
    floatHeight: 4,
    floatSpeed: 6,
    spacing: 0.35,
    depth: 1,
    glow: 1,
    color: '#60a5fa',
  };

  function hexToRGB(hex) {
    return [
      parseInt(hex.slice(1, 3), 16),
      parseInt(hex.slice(3, 5), 16),
      parseInt(hex.slice(5, 7), 16),
    ];
  }

  function updateShadow() {
    const d = params.depth;
    const g = params.glow;
    const [r, gn, b] = hexToRGB(params.color);
    el.style.textShadow = [
      `0 ${1 * d}px 0 rgba(${r},${gn},${b},${(0.4 * d).toFixed(2)})`,
      `0 ${2 * d}px 0 rgba(${r},${gn},${b},${(0.3 * d).toFixed(2)})`,
      `0 ${3 * d}px 0 rgba(${r},${gn},${b},${(0.2 * d).toFixed(2)})`,
      `0 ${4 * d}px 0 rgba(${r},${gn},${b},${(0.15 * d).toFixed(2)})`,
      `0 ${5 * d}px 0 rgba(${r},${gn},${b},${(0.1 * d).toFixed(2)})`,
      `0 ${(8 * d).toFixed(1)}px ${(20 * g).toFixed(1)}px rgba(${r},${gn},${b},${(0.25 * g).toFixed(2)})`,
      `0 0 ${(40 * g).toFixed(1)}px rgba(${r},${gn},${b},${(0.12 * g).toFixed(2)})`,
    ].join(', ');
  }

  function updateGradient() {
    const c = params.color;
    el.style.background = `linear-gradient(120deg, #cbd5e1 0%, #f0f4ff 18%, ${c} 36%, #a78bfa 50%, ${c} 64%, #f0f4ff 82%, #cbd5e1 100%)`;
    el.style.backgroundSize = '250% 100%';
    el.style.webkitBackgroundClip = 'text';
    el.style.backgroundClip = 'text';
  }

  const folder = gui.addFolder('Title');

  folder.add(params, 'shimmerSpeed', 1, 10, 0.1).name('Shimmer Speed')
    .onChange(v => el.style.setProperty('--shimmer-dur', v + 's'));

  folder.add(params, 'glintSpeed', 1, 8, 0.1).name('Glint Speed')
    .onChange(v => el.style.setProperty('--glint-dur', v + 's'));

  folder.add(params, 'floatHeight', 0, 20, 0.5).name('Float Height')
    .onChange(v => el.style.setProperty('--float-amp', -v + 'px'));

  folder.add(params, 'floatSpeed', 1, 12, 0.1).name('Float Speed')
    .onChange(v => el.style.setProperty('--float-dur', v + 's'));

  folder.add(params, 'spacing', 0, 0.8, 0.01).name('Letter Spacing')
    .onChange(v => { el.style.letterSpacing = v + 'em'; });

  folder.add(params, 'depth', 0, 3, 0.05).name('3D Depth')
    .onChange(updateShadow);

  folder.add(params, 'glow', 0, 3, 0.05).name('Glow')
    .onChange(updateShadow);

  folder.addColor(params, 'color').name('Accent Color')
    .onChange(() => { updateShadow(); updateGradient(); });

  folder.open();
}

function setupCameraGUI(gui, state, camera) {
  const camFolder = gui.addFolder("Camera");
  camFolder.add(state, "startDistance", 50, 800).name("Start Distance").onChange((v) => {
    state.zoomTarget.set(0, 5, 25);
    camera.position.set(0, v * 0.27, v);
    state.zoomActive = true;
  });
  camFolder.add(state, "zoomSpeed", 0.005, 0.1).name("Zoom Speed");
}

/**
 * Click near a planet to lock the camera on it.
 *
 * @param {THREE.WebGLRenderer} renderer - renderer whose canvas receives clicks
 * @param {THREE.Camera} camera - current camera
 * @param {Array} planets - array of {mesh, pivot, def} planet objects
 * @param {object} state - interaction state (followPlanet will be set)
 */
function setupPlanetFollowHandler(renderer, camera, planets, state) {
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();

  renderer.domElement.addEventListener("click", (e) => {
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);

    let closest = null;
    let closestDist = Infinity;
    const wp = new THREE.Vector3();

    for (const p of planets) {
      p.mesh.getWorldPosition(wp);
      const dist = raycaster.ray.distanceToPoint(wp);
      const threshold = Math.max(p.def.radius * 5, 3);
      if (dist < threshold && dist < closestDist) {
        closestDist = dist;
        closest = p;
      }
    }

    if (closest) {
      state.followPlanet = closest;
      state.zoomActive = false;
    } else {
      state.followPlanet = null;
    }
  });
}

/**
 * Wire up mouse and touch events for camera control.
 *
 * @param {HTMLElement} container - element listening for touch/drag
 * @param {THREE.Camera} camera - used to read initial z position
 * @returns {object} state object containing current target and input values
 */
function setupInteractions(container, camera) {
  const state = {
    targetCam: new THREE.Vector3(),
    mouseX: 0,
    mouseY: 0,
    targetZ: camera.position.z,
    keys: { w: false, a: false, s: false, d: false, q: false, e: false },
    moveSpeed: 14,
    startDistance: 300,
    zoomTarget: new THREE.Vector3(0, 5, 25),
    zoomActive: true,
    zoomSpeed: 0.012,
    followPlanet: null,
  };
  // Mouse position drives camera look direction
  container.addEventListener("mousemove", (e) => {
    const rect = container.getBoundingClientRect();
    state.mouseX = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    state.mouseY = ((e.clientY - rect.top) / rect.height) * 2 - 1;
  });
  container.addEventListener("contextmenu", (e) => e.preventDefault());
  window.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      const dir = new THREE.Vector3();
      camera.getWorldDirection(dir);
      const amt = -e.deltaY * 0.025;
      camera.position.addScaledVector(dir, amt);
    },
    { passive: false }
  );
  window.addEventListener("keydown", (e) => {
    const k = e.key.toLowerCase();
    if (k in state.keys) state.keys[k] = true;
    if (e.key === "Escape") state.followPlanet = null;
  });
  window.addEventListener("keyup", (e) => {
    const k = e.key.toLowerCase();
    if (k in state.keys) state.keys[k] = false;
  });
  let isPinching = false,
    pinchStartDist = 0,
    pinchStartZ = state.targetZ;
  container.addEventListener(
    "touchstart",
    (e) => {
      if (e.touches.length === 2) {
        isPinching = true;
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        pinchStartDist = Math.hypot(dx, dy);
        pinchStartZ = state.targetZ;
        e.preventDefault();
      }
    },
    { passive: false }
  );
  container.addEventListener(
    "touchmove",
    (e) => {
      if (isPinching && e.touches.length === 2) {
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        const dist = Math.hypot(dx, dy);
        if (pinchStartDist > 0) {
          const ratio = pinchStartDist / dist;
          state.targetZ = pinchStartZ * ratio;
        }
        e.preventDefault();
      }
    },
    { passive: false }
  );
  container.addEventListener("touchend", (e) => {
    if (e.touches.length < 2) isPinching = false;
  });
  return state;
}

function handleResize(container, camera, renderer, composer) {
  const w = container.clientWidth,
    h = container.clientHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
  composer.setSize(w, h);
}

function animateLoop(scene, camera, composer, planets, starField, state, worlds) {
  const clock = new THREE.Clock();
  (function tick() {
    requestAnimationFrame(tick);
    const t = clock.getDelta();
    // Orbit and spin each planet
    for (const p of planets) {
      p.pivot.rotation.y += t * p.def.speed;
      p.mesh.rotation.y += t * 0.2;
    }
    starField.rotation.y += t * 0.001;
    // Update pyramid fields
    if (worlds) {
      for (const w of worlds) {
        if (w.pyramidField) w.pyramidField.update(t);
      }
    }
    // Planet follow — WASD or Escape disengages
    if (state.followPlanet) {
      if (state.keys && (state.keys.w || state.keys.a || state.keys.s || state.keys.d || state.keys.q || state.keys.e)) {
        state.followPlanet = null;
      }
    }
    if (state.sunLight) {
      const targetIntensity = state.followPlanet ? 1.2 : 3;
      state.sunLight.intensity += (targetIntensity - state.sunLight.intensity) * 0.04;
    }
    if (state.followPlanet) {
      const planetPos = new THREE.Vector3();
      state.followPlanet.mesh.getWorldPosition(planetPos);
      // Fixed offset so the camera doesn't orbit with the planet
      const targetPos = planetPos.clone();
      targetPos.y += 3;
      targetPos.z += 8;
      camera.position.lerp(targetPos, 0.03);
      camera.lookAt(planetPos);
    } else {
      // WASD movement — forward is the full camera direction
      if (state.keys) {
        const forward = new THREE.Vector3();
        camera.getWorldDirection(forward);
        const right = new THREE.Vector3().crossVectors(forward, camera.up).normalize();
        const speed = state.moveSpeed * t;
        if (state.keys.w) camera.position.addScaledVector(forward, speed);
        if (state.keys.s) camera.position.addScaledVector(forward, -speed);
        if (state.keys.a) camera.position.addScaledVector(right, -speed);
        if (state.keys.d) camera.position.addScaledVector(right, speed);
        if (state.keys.q) camera.position.y -= speed;
        if (state.keys.e) camera.position.y += speed;
      }
      // Zoom-in animation
      if (state.zoomActive) {
        camera.position.lerp(state.zoomTarget, state.zoomSpeed);
        if (camera.position.distanceTo(state.zoomTarget) < 0.5) {
          state.zoomActive = false;
        }
      }
      // Mouse-driven camera look
      camera.rotation.order = "YXZ";
      const targetYaw = -state.mouseX * Math.PI * 0.12;
      const targetPitch = -state.mouseY * Math.PI * 0.06 - 0.15;
      camera.rotation.y += (targetYaw - camera.rotation.y) * 0.06;
      camera.rotation.x += (targetPitch - camera.rotation.x) * 0.06;
    }
    composer.render();
  })();
}

// --- Audio state management ------------------------------------------------

function createAudioState() {
  return { stream: null, fft: null, audioEl: null, _liveStream: null };
}

function stopAudio(audioState) {
  if (audioState.stream) {
    audioState.stream.stop();
    audioState.stream = null;
  }
  if (audioState.audioEl) {
    try { audioState.audioEl.pause(); } catch (_) {}
    audioState.audioEl = null;
  }
  if (audioState._liveStream) {
    for (const track of audioState._liveStream.getTracks()) track.stop();
    audioState._liveStream = null;
  }
}

async function toggleAudioPlayback(audioState) {
  if (!audioState.audioEl) return false;
  if (audioState.audioEl.paused) {
    if (audioState.fft && audioState.fft.context && audioState.fft.context.state === "suspended") {
      await audioState.fft.context.resume();
    }
    await audioState.audioEl.play();
    if (audioState.stream) audioState.stream.start();
    return true;
  }
  audioState.audioEl.pause();
  if (audioState.stream) audioState.stream.stop();
  return false;
}

// --- Audio element + FFT wiring -------------------------------------------

function createAudioElement(src) {
  const el = document.createElement("audio");
  el.src = src;
  el.crossOrigin = "anonymous";
  el.controls = false;
  el.preload = "auto";
  return el;
}

async function loadAudioSource(source, audioState, onSpectrum, onNewSource, beatDetector) {
  stopAudio(audioState);
  const url = source instanceof Blob ? URL.createObjectURL(source) : source;
  audioState.audioEl = createAudioElement(url);
  const fft = new AudioFFT({ audioElement: audioState.audioEl, context: null });
  try { await fft.load(); } catch (err) { console.warn("AudioFFT.load() failed:", err); }
  audioState.fft = fft;
  if (beatDetector && fft.analyser) beatDetector.setAnalyser(fft.analyser);
  if (onNewSource) onNewSource();
  const stream = fft.createStream();
  stream.onData(onSpectrum);
  audioState.stream = stream;
}

// --- Planet click-to-play/pause -------------------------------------------

function setupPlanetClickHandler(renderer, camera, sphere, audioState) {
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  renderer.domElement.addEventListener("click", async (e) => {
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    if (raycaster.intersectObject(sphere).length === 0) return;
    try { await toggleAudioPlayback(audioState); } catch (err) { console.warn("Audio toggle failed:", err); }
  });
}

// --- Live audio helpers ---------------------------------------------------

async function startLiveAudio(mode, audioState, onSpectrum, onNewSource, beatDetector) {
  const mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
  stopAudio(audioState);
  audioState._liveStream = mediaStream;
  audioState.audioEl = null;

  const fft = new AudioFFT({ context: null });
  fft.loadMediaStream(mediaStream);
  audioState.fft = fft;
  if (beatDetector && fft.analyser) beatDetector.setAnalyser(fft.analyser);
  if (onNewSource) onNewSource();

  const stream = fft.createStream();
  stream.onData(onSpectrum);
  stream.start();
  audioState.stream = stream;
  return mediaStream;
}

function stopLiveAudio(audioState) {
  if (audioState._liveStream) {
    for (const track of audioState._liveStream.getTracks()) track.stop();
    audioState._liveStream = null;
  }
}

// --- Song picker DOM ------------------------------------------------------

function createSongPickerDOM(isMobile) {
  const wrapper = document.createElement("div");
  if (isMobile) {
    wrapper.style.cssText =
      "position:relative;z-index:20;" +
      "background:rgba(0,0,0,0.5);padding:10px;border-radius:6px;color:#e6eef8;font-size:14px;" +
      "display:flex;align-items:center;gap:10px;flex-wrap:wrap;";
  } else {
    wrapper.style.cssText =
      "position:relative;z-index:20;" +
      "background:rgba(0,0,0,0.4);padding:8px;border-radius:6px;color:#e6eef8;font-size:12px;" +
      "display:flex;align-items:center;gap:8px;flex-wrap:wrap;";
  }
  const driveFilesList = document.createElement("select");
  driveFilesList.style.cssText = "display:none;";
  driveFilesList.appendChild(new Option("Select an audio file...", ""));

  const btnStyle =
    "padding:4px 10px;border:1px solid rgba(255,255,255,0.3);border-radius:4px;" +
    "background:rgba(255,255,255,0.08);color:#e6eef8;cursor:pointer;font-size:12px;" +
    "transition:background 0.2s;";
  const activeBtnStyle =
    "padding:4px 10px;border:1px solid #60a5fa;border-radius:4px;" +
    "background:rgba(96,165,250,0.25);color:#60a5fa;cursor:pointer;font-size:12px;" +
    "transition:background 0.2s;";

  const micBtn = document.createElement("button");
  micBtn.textContent = "Mic";
  micBtn.title = "Use microphone as live audio input";
  micBtn.style.cssText = btnStyle;

  wrapper.appendChild(driveFilesList);
  wrapper.appendChild(micBtn);
  return { wrapper, driveFilesList, micBtn, btnStyle, activeBtnStyle };
}

// --- Google Drive song picker ---------------------------------------------

function setupSongPicker(parentEl, audioState, onSpectrum, onNewSource, isMobile, beatDetector) {
  initializeGoogleAuth();
  const dom = createSongPickerDOM(isMobile);
  parentEl.appendChild(dom.wrapper);
  const driveState = { provider: null };
  let activeLiveMode = null; // "mic" | "desktop" | null

  function deactivateLive() {
    stopLiveAudio(audioState);
    dom.micBtn.style.cssText = dom.btnStyle;
    activeLiveMode = null;
  }

  async function toggleLive() {
    if (activeLiveMode === "mic") {
      deactivateLive();
      stopAudio(audioState);
      return;
    }
    deactivateLive();
    try {
      await startLiveAudio("mic", audioState, onSpectrum, onNewSource, beatDetector);
      activeLiveMode = "mic";
      dom.micBtn.style.cssText = dom.activeBtnStyle;
    } catch (err) {
      console.warn("Live audio (mic) failed:", err);
    }
  }

  dom.micBtn.addEventListener("click", () => toggleLive());

  async function loadDriveFile(fileId) {
    if (!fileId || !driveState.provider) return;
    deactivateLive();
    const blob = await driveState.provider.fetchFileBlob(fileId);
    await loadAudioSource(blob, audioState, onSpectrum, onNewSource, beatDetector);
    try {
      // Resume AudioContext (browsers suspend it until user gesture)
      if (audioState.fft && audioState.fft.context && audioState.fft.context.state === "suspended") {
        await audioState.fft.context.resume();
      }
      await audioState.audioEl.play();
      if (audioState.stream) audioState.stream.start();
    } catch (err) { console.warn("Auto-play failed:", err); }
  }

  dom.driveFilesList.addEventListener("change", async (e) => {
    if (!e.target.value || !driveState.provider) return;
    try { await loadDriveFile(e.target.value); } catch (err) { console.error("Error loading audio:", err); }
  });

  async function connectDrive(provider, autoSelectFirst) {
    driveState.provider = provider;
    const files = await provider.listAllFiles();
    if (files.length === 0) return;
    dom.driveFilesList.innerHTML = '<option value="">Select an audio file...</option>';
    files.forEach((f) => dom.driveFilesList.appendChild(new Option(f.name, f.id)));
    dom.driveFilesList.style.display = "inline-block";
    if (autoSelectFirst) {
      dom.driveFilesList.value = files[0].id;
      await loadDriveFile(files[0].id);
    }
  }

  const presetFolderId = appConfig.googleDrive.folderId ||
    (typeof window !== "undefined" ? window.__GOOGLE_DRIVE_FOLDER_ID__ : null);
  const presetApiKey = appConfig.googleDrive.apiKey ||
    (typeof window !== "undefined" ? window.__GOOGLE_API_KEY__ : null);
  if (presetFolderId) {
    const provider = new GoogleDriveAudioProvider({ folderId: presetFolderId, apiKey: presetApiKey || null });
    connectDrive(provider, true).catch((err) => {
      console.error("Configured Google Drive folder failed:", err);
    });
  }
  return dom.wrapper;
}

// --- Planet interior (camera inside) ------------------------------------

const _planetCenterScratch = new THREE.Vector3();
const _planetScaleScratch = new THREE.Vector3();

/**
 * @param {{ mesh: import("three").Mesh, def: { radius: number } }} planet
 * @returns {number}
 */
function getPlanetWorldRadius(planet) {
  planet.mesh.getWorldScale(_planetScaleScratch);
  const m = Math.max(_planetScaleScratch.x, _planetScaleScratch.y, _planetScaleScratch.z);
  return (planet.def?.radius ?? 0.9) * m;
}

/**
 * @param {import("three").Vector3} pos
 * @param {Array<{ mesh: import("three").Mesh, def: { radius: number } }>} planets
 * @returns {boolean}
 */
function isCameraInsideAnyPlanet(pos, planets) {
  for (const p of planets) {
    p.mesh.getWorldPosition(_planetCenterScratch);
    if (pos.distanceTo(_planetCenterScratch) < getPlanetWorldRadius(p)) return true;
  }
  return false;
}

// --- Scene initialization -------------------------------------------------

function initScene() {
  cleanupDevServiceWorkers();
  const container = document.getElementById("three-container");
  if (!container) { console.warn("No #three-container found"); return; }

  const scene = new THREE.Scene();
  const camera = createCamera(container);
  const isMobile = detectMobile();
  const renderer = createRenderer(container);
  const { composer, bloomPass } = setupPostProcessing(renderer, scene, camera, container);

  // Build solar system via SolarSystem class
  const solarSystem = new SolarSystem(isMobile);
  solarSystem.addToScene(scene);

  const primary = solarSystem.primary;
  const sphere = primary.mesh;
  const material = primary.material;

  const baseRadius = primary.def.radius;
  const planetParams = { radius: baseRadius };
  let gui;
  let radiusCtrl = null;
  if (isEnabled("ENABLE_GUI")) {
    ({ gui, radiusCtrl } = setupGUI(material, planetParams, sphere, baseRadius));
  }

  // Comet streaking across the sky, brightness driven by audio loudness
  const comet = new Comet();
  scene.add(comet.group);
  if (gui) comet.setupGUI(gui);

  const pyramidField = new PyramidField();
  sphere.add(pyramidField.group);
  if (gui) pyramidField.setupGUI(gui);

  const SNAPSHOT_COUNT = 5;
  const SNAPSHOT_INTERVAL = 8;
  let snapshotState = null;

  const beatDetector = new BeatDetector();
  if (gui) beatDetector.setupGUI(gui);

  const audioState = createAudioState();
  /** Fixed baseline for FFT-driven bloom strength (cockpit bloom dial removed). */
  const bloomBaseline = { multiplier: 1 };
  const bloomSmooth = {
    strength: bloomPass.strength,
    lastMultiplier: bloomBaseline.multiplier,
  };
  let syncMusicUi = () => {};
  const onSpectrum = (spectrum) => {
    if (audioState._liveStream) {
      pyramidField.setKeyframes(null);
      pyramidField.applySpectrum(spectrum);
    } else if (snapshotState && snapshotState.snapshots.length < SNAPSHOT_COUNT) {
      if (spectrum.some((v) => v > 0)) {
        snapshotState.frameCount++;
        if (snapshotState.frameCount === 1) {
          pyramidField.applySpectrum(spectrum);
          snapshotState.snapshots.push(new Float32Array(spectrum));
        } else if (snapshotState.frameCount % SNAPSHOT_INTERVAL === 0) {
          snapshotState.snapshots.push(new Float32Array(spectrum));
          if (snapshotState.snapshots.length === SNAPSHOT_COUNT) {
            const duration = audioState.audioEl ? audioState.audioEl.duration : 0;
            pyramidField.setKeyframes(snapshotState.snapshots, duration);
          }
        }
      }
    }
    const loudness = spectrum.reduce((a, v) => a + v, 0) / spectrum.length;
    comet.setLoudness(loudness);

    applySpectrumToParams(spectrum, {
      planetParams,
      radiusCtrl,
      bloomPass,
      bloomBaseline,
      bloomSmooth,
      material,
      sphere,
      baseRadius,
    });

    beatDetector.update(spectrum);
  };

  setupPlanetClickHandler(renderer, camera, sphere, audioState);

  const onNewAudioSource = () => {
    snapshotState = { snapshots: [], frameCount: 0 };
    pyramidField.resetMusicClock();
    syncMusicUi();
  };

  if (gui) {
    const bottomHud = document.createElement("div");
    bottomHud.className = "bottom-left-hud";
    container.appendChild(bottomHud);
    const cockpit = mountScreenDials(bottomHud, {
      pyramidField,
      audioState,
      toggleAudioPlayback,
    });
    syncMusicUi = cockpit.syncMusicToggle;
    setupSongPicker(bottomHud, audioState, onSpectrum, onNewAudioSource, isMobile, beatDetector);
    bottomHud.appendChild(gui.domElement);
  } else {
    setupSongPicker(container, audioState, onSpectrum, onNewAudioSource, isMobile, beatDetector);
  }

  // Camera controller via CameraController class
  const camCtrl = new CameraController(container, camera, { isMobile });
  camCtrl.sun = solarSystem.sun;
  camCtrl.sunLight = solarSystem.sunLight;
  camCtrl.setupFollowHandler(renderer, solarSystem.planets);
  // Fly in directly to the blue planet on startup
  camCtrl.followPlanet = solarSystem.planets[0];
  camCtrl.defaultFollowPlanet = solarSystem.planets[0];
  camCtrl.zoomActive = false;
  if (gui) camCtrl.setupGUI(gui);
  if (gui) setupTitleGUI(gui);

  const planetGoopOverlay = document.createElement("div");
  planetGoopOverlay.className = "planet-goop-overlay";
  planetGoopOverlay.setAttribute("aria-hidden", "true");
  const goopWash = document.createElement("div");
  goopWash.className = "planet-goop-overlay__wash";
  const goopDrips = document.createElement("div");
  goopDrips.className = "planet-goop-overlay__drips";
  const goopStreaks = document.createElement("div");
  goopStreaks.className = "planet-goop-overlay__streaks";
  const goopShine = document.createElement("div");
  goopShine.className = "planet-goop-overlay__shine";
  planetGoopOverlay.appendChild(goopWash);
  planetGoopOverlay.appendChild(goopDrips);
  planetGoopOverlay.appendChild(goopStreaks);
  planetGoopOverlay.appendChild(goopShine);
  container.appendChild(planetGoopOverlay);

  window.addEventListener("resize", () => handleResize(container, camera, renderer, composer));

  // Animation loop delegates to SolarSystem.update + CameraController.update
  const clock = new THREE.Clock();
  (function tick() {
    requestAnimationFrame(tick);
    if (audioState.stream) audioState.stream.pump();
    const t = clock.getDelta();
    solarSystem.update(t);
    // Keep the comet orbiting around whichever planet the camera is watching
    const _cometAnchor = new THREE.Vector3();
    (camCtrl.followPlanet ? camCtrl.followPlanet.mesh : sphere).getWorldPosition(_cometAnchor);
    comet.setAnchor(_cometAnchor);
    comet.update(t);
    const audioTime =
      audioState.audioEl && !audioState._liveStream
        ? audioState.audioEl.currentTime
        : null;
    pyramidField.update(t, {
      bpm: beatDetector.getEffectiveBpm(),
      barDuration: beatDetector.barDuration,
      audioCurrentTime: audioTime,
    });
    camCtrl.update(t);
    planetGoopOverlay.classList.toggle(
      "planet-goop-overlay--visible",
      isCameraInsideAnyPlanet(camera.position, solarSystem.planets)
    );
    composer.render();
  })();
}

// --- Spectrum → scene parameter mapping -----------------------------------

/**
 * Scale planet albedo from bloom baseline multiplier (FFT path); multiplier 1 → unity vs stored base.
 * @param {THREE.MeshPhysicalMaterial} material
 * @param {number} bloom_dial_multiplier
 */
function applyPlanetBrightnessFromBloomDial(material, bloom_dial_multiplier) {
  const base = material.userData?.planetBaseColor;
  if (!base || typeof material.color?.copy !== "function") return;
  const scale = 0.55 + 0.45 * bloom_dial_multiplier;
  material.color.copy(base).multiplyScalar(scale);
}

/** Smoothing factor for bloom strength toward FFT×dial target (when `bloomSmooth` is used). */
const BLOOM_STRENGTH_SMOOTH_ALPHA = 0.22;

/**
 * @param {object} ctx
 * @param {number} target - midAvg * 3 * multiplier (FFT applied to dial scale)
 */
function updateBloomStrengthFromSpectrum(ctx, target) {
  const { bloomPass, bloomBaseline, bloomSmooth } = ctx;
  const m = bloomBaseline?.multiplier ?? 1;

  if (!bloomSmooth) {
    bloomPass.strength = target;
    return;
  }

  let b = bloomSmooth.strength;
  if (m !== bloomSmooth.lastMultiplier) {
    bloomSmooth.lastMultiplier = m;
    b = target;
  } else {
    b = b + BLOOM_STRENGTH_SMOOTH_ALPHA * (target - b);
  }
  bloomSmooth.strength = b;
  bloomPass.strength = b;
}

function applySpectrumToParams(
  spectrum,
  { planetParams, radiusCtrl, bloomPass, bloomBaseline, bloomSmooth, material, sphere, baseRadius }
) {
  const len = spectrum.length;
  const third = Math.floor(len / 3);
  const low = spectrum.slice(0, third);
  const mid = spectrum.slice(third, third * 2);
  const high = spectrum.slice(third * 2);

  const avg = (arr) => (arr.reduce((a, v) => a + v, 0) / arr.length) || 0;
  const lowAvg = avg(low);
  const midAvg = avg(mid);
  const highAvg = avg(high);

  const { smoothedScale, displayRadius } = computeSmoothedPlanetScale(
    lowAvg,
    baseRadius,
    sphere.scale.x,
  );
  planetParams.radius = displayRadius;
  sphere.scale.setScalar(smoothedScale);
  if (radiusCtrl) radiusCtrl.updateDisplay();

  const baseline_multiplier = bloomBaseline?.multiplier ?? 1;
  const bloomTarget = midAvg * 3 * baseline_multiplier;
  updateBloomStrengthFromSpectrum({ bloomPass, bloomBaseline, bloomSmooth }, bloomTarget);
  applyPlanetBrightnessFromBloomDial(material, baseline_multiplier);
  bloomPass.threshold = highAvg;
  material.reflectivity = 0.2 + highAvg * 0.8;
}

initScene();

// named exports so tests can import helpers
export {
  detectMobile,
  createCamera,
  createRenderer,
  setupPostProcessing,
  createSphere,
  createSun,
  createPlanet,
  PLANET_DEFS,
  createStars,
  setupLights,
  setupGUI,
  setupInteractions,
  setupTitleGUI,
  setupCameraGUI,
  setupPlanetFollowHandler,
  handleResize,
  animateLoop,
  initScene,
  computeSmoothedPlanetScale,
  BLOOM_STRENGTH_SMOOTH_ALPHA,
  applyPlanetBrightnessFromBloomDial,
  applySpectrumToParams,
  createAudioState,
  stopAudio,
  toggleAudioPlayback,
  createAudioElement,
  loadAudioSource,
  setupPlanetClickHandler,
  createSongPickerDOM,
  setupSongPicker,
  startLiveAudio,
  stopLiveAudio,
  SolarSystem,
  CameraController,
  AudioManager,
  Comet,
};
