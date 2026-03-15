// Import ES module build from node_modules so the browser can resolve it when served statically
import * as THREE from "/node_modules/three/build/three.module.js";
import { EffectComposer } from "/node_modules/three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "/node_modules/three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "/node_modules/three/examples/jsm/postprocessing/UnrealBloomPass.js";
// GUI library for runtime tweaking
import GUI from "/node_modules/lil-gui/dist/lil-gui.esm.min.js";
import AudioFFT from "../audio/audio-fft.js";
import { isEnabled } from "../config/feature-flags.js";
import appConfig from "../config/app-config.js";
import {
  initializeGoogleAuth,
  requestGoogleAuth,
  showGoogleDrivePicker,
  getAccessToken,
} from "../google/google-auth.js";
import GoogleDriveAudioProvider from "../google/google-drive-audio.js";
import PyramidField from "../pyramid/pyramid-field.js";

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
    1000
  );
  cam.position.set(0, 0, 5);
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
  const count = isMobile ? 600 : 1500;
  const pos = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const r = 30 + Math.random() * 70;
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
function setupLights(scene) {
  const light = new THREE.DirectionalLight(0xffffff, 2.0);
  light.position.set(5, 5, 5);
  scene.add(light);
  const lightSphere = new THREE.Mesh(
    new THREE.SphereGeometry(0.12, 8, 8),
    new THREE.MeshBasicMaterial({ color: 0xfff3d6 })
  );
  lightSphere.position.copy(light.position);
  scene.add(lightSphere);
  scene.add(new THREE.AmbientLight(0x6b6f88, 0.6));
  scene.add(new THREE.HemisphereLight(0xddeeff, 0x101020, 0.35));
  const fill = new THREE.PointLight(0xffffff, 0.45, 20);
  fill.position.set(0, 0, 4.0);
  scene.add(fill);
}

/**
 * Build the GUI controller window for runtime parameter tweaking.
 *
 * @param {THREE.Material} material - planet material to adjust
 * @param {UnrealBloomPass} bloomPass - bloom effect to tweak
 * @param {THREE.Object3D} starField - object to toggle visibility
 */
function setupGUI(material, bloomPass, starField) {
  const gui = new GUI();
  const planet = gui.addFolder("Planet");
  planet.addColor(material, "color");
  planet.add(material, "metalness", 0, 1);
  planet.add(material, "roughness", 0, 1);
  planet.add(material, "clearcoat", 0, 1);
  planet.add(material, "clearcoatRoughness", 0, 1);
  planet.add(material, "reflectivity", 0, 1);
  planet.open();
  const effects = gui.addFolder("Effects");
  effects.add(bloomPass, "strength", 0, 3);
  effects.add(bloomPass, "radius", 0, 1);
  effects.add(bloomPass, "threshold", 0, 1);
  effects.open();
  const stars = gui.addFolder("Stars");
  stars.add(starField, "visible");
  stars.open();
  // return both gui and effects folder so callers can add extra controls there
  return { gui, effects };
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
  };
  const minZ = 2.0,
    maxZ = 25.0;
  window.addEventListener("mousemove", (e) => {
    const rect = container.getBoundingClientRect();
    state.mouseX = (e.clientX - rect.left) / rect.width - 0.5;
    state.mouseY = (e.clientY - rect.top) / rect.height - 0.5;
  });
  window.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      state.targetZ += e.deltaY * 0.01;
      state.targetZ = THREE.MathUtils.clamp(state.targetZ, minZ, maxZ);
    },
    { passive: false }
  );
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
      } else if (e.touches.length === 1) {
        const rect = container.getBoundingClientRect();
        state.mouseX = (e.touches[0].clientX - rect.left) / rect.width - 0.5;
        state.mouseY = (e.touches[0].clientY - rect.top) / rect.height - 0.5;
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
          state.targetZ = THREE.MathUtils.clamp(state.targetZ, minZ, maxZ);
        }
        e.preventDefault();
      } else if (e.touches.length === 1) {
        const rect = container.getBoundingClientRect();
        state.mouseX = (e.touches[0].clientX - rect.left) / rect.width - 0.5;
        state.mouseY = (e.touches[0].clientY - rect.top) / rect.height - 0.5;
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

function animateLoop(scene, camera, composer, sphere, starField, state, world) {
  const clock = new THREE.Clock();
  (function tick() {
    requestAnimationFrame(tick);
    const t = clock.getDelta();
    sphere.rotation.y += t * 0.2;
    sphere.rotation.x += t * 0.08;
    starField.rotation.y += t * 0.002;
    if (world && world.pyramidField) world.pyramidField.update(t);
    state.targetCam.x = state.mouseX * 0.8;
    state.targetCam.y = -state.mouseY * 0.6;
    camera.position.x += (state.targetCam.x - camera.position.x) * 0.06;
    camera.position.y += (state.targetCam.y - camera.position.y) * 0.06;
    camera.position.z += (state.targetZ - camera.position.z) * 0.06;
    camera.lookAt(0, 0, 0);
    composer.render();
  })();
}

// --- Audio state management ------------------------------------------------

function createAudioState() {
  return { stream: null, fft: null, audioEl: null };
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

async function loadAudioSource(source, audioState, onSpectrum, onNewSource) {
  stopAudio(audioState);
  const url = source instanceof Blob ? URL.createObjectURL(source) : source;
  audioState.audioEl = createAudioElement(url);
  const fft = new AudioFFT({ audioElement: audioState.audioEl, context: null });
  try { await fft.load(); } catch (err) { console.warn("AudioFFT.load() failed:", err); }
  audioState.fft = fft;
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

// --- Song picker DOM ------------------------------------------------------

function createSongPickerDOM() {
  const wrapper = document.createElement("div");
  wrapper.style.cssText =
    "position:absolute;bottom:12px;left:12px;z-index:20;" +
    "background:rgba(0,0,0,0.4);padding:8px;border-radius:6px;color:#e6eef8;font-size:12px;";
  const folderLabel = document.createElement("span");
  folderLabel.style.cssText = "opacity:0.9;";
  folderLabel.textContent = "Folder: none";
  const driveFilesList = document.createElement("select");
  driveFilesList.style.cssText = "margin-left:8px;display:none;";
  driveFilesList.appendChild(new Option("Select an audio file...", ""));
  wrapper.appendChild(folderLabel);
  wrapper.appendChild(driveFilesList);
  return { wrapper, folderLabel, driveFilesList };
}

// --- Google Drive song picker ---------------------------------------------

function setupSongPicker(container, audioState, onSpectrum, onNewSource) {
  initializeGoogleAuth();
  const dom = createSongPickerDOM();
  container.appendChild(dom.wrapper);
  const driveState = { provider: null };

  async function loadDriveFile(fileId) {
    if (!fileId || !driveState.provider) return;
    const blob = await driveState.provider.fetchFileBlob(fileId);
    await loadAudioSource(blob, audioState, onSpectrum, onNewSource);
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

  async function connectDrive(provider, folderNameHint, autoSelectFirst) {
    driveState.provider = provider;
    dom.folderLabel.textContent = `Folder: ${folderNameHint}`;
    try {
      const folder = await provider.getFolder();
      if (folder && folder.name) dom.folderLabel.textContent = `Folder: ${folder.name}`;
    } catch (err) { console.warn("Unable to fetch folder name:", err); }
    const files = await provider.listAllFiles();
    if (files.length === 0) { dom.folderLabel.textContent += " (empty)"; return; }
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
    connectDrive(provider, "Configured folder", true).catch((err) => {
      console.error("Configured Google Drive folder failed:", err);
      dom.folderLabel.textContent = "Folder: unavailable";
    });
  }
}

// --- Scene initialization -------------------------------------------------

function initScene() {
  cleanupDevServiceWorkers();
  const container = document.getElementById("three-container");
  if (!container) { console.warn("No #three-container found"); return; }

  const scene = new THREE.Scene();
  const camera = createCamera(container);
  camera.position.z = 7;
  const isMobile = detectMobile();
  const renderer = createRenderer(container);
  const { composer, bloomPass } = setupPostProcessing(renderer, scene, camera, container);
  const { sphere, material } = createSphere(isMobile);
  scene.add(sphere);
  const starField = createStars(isMobile);
  scene.add(starField);
  setupLights(scene);

  let gui, effects;
  if (isEnabled("ENABLE_GUI")) {
    ({ gui, effects } = setupGUI(material, bloomPass, starField));
  }
  const baseRadius = 0.9;
  const planetParams = { radius: baseRadius };
  let radiusCtrl = null;
  if (effects) {
    radiusCtrl = effects.add(planetParams, "radius", 0.2, 2);
    radiusCtrl.onChange((v) => sphere.scale.setScalar(v / baseRadius));
  }

  // Pyramids are deferred until a valid audio source loads.
  // We collect 5 FFT snapshots spaced across early playback to use as keyframes.
  const world = { pyramidField: null };
  const SNAPSHOT_COUNT = 5;
  const SNAPSHOT_INTERVAL = 8; // take a snapshot every N non-zero frames
  let snapshotState = null; // { snapshots: [], frameCount: 0 }

  function ensurePyramids() {
    if (!world.pyramidField) {
      world.pyramidField = new PyramidField();
      scene.add(world.pyramidField.group);
      if (gui) world.pyramidField.setupGUI(gui);
    }
  }

  const audioState = createAudioState();
  const onSpectrum = (spectrum) => {
    // Collect snapshots for pyramid keyframes
    if (snapshotState && snapshotState.snapshots.length < SNAPSHOT_COUNT) {
      if (spectrum.some((v) => v > 0)) {
        snapshotState.frameCount++;
        // Capture the very first non-zero frame as snapshot 0 AND apply it
        // immediately so there's no jump when setKeyframes later applies kf 0.
        if (snapshotState.frameCount === 1) {
          ensurePyramids();
          world.pyramidField.applySpectrum(spectrum);
          snapshotState.snapshots.push(new Float32Array(spectrum));
        } else if (snapshotState.frameCount % SNAPSHOT_INTERVAL === 0) {
          ensurePyramids();
          snapshotState.snapshots.push(new Float32Array(spectrum));
          if (snapshotState.snapshots.length === SNAPSHOT_COUNT) {
            const duration = audioState.audioEl ? audioState.audioEl.duration : 0;
            world.pyramidField.setKeyframes(snapshotState.snapshots, duration);
          }
        }
      }
    }
    applySpectrumToParams(spectrum, {
      planetParams, radiusCtrl, bloomPass, material, sphere, baseRadius,
    });
  };

  setupPlanetClickHandler(renderer, camera, sphere, audioState);
  setupSongPicker(container, audioState, onSpectrum, () => {
    snapshotState = { snapshots: [], frameCount: 0 };
  });

  const state = setupInteractions(container, camera);
  window.addEventListener("resize", () => handleResize(container, camera, renderer, composer));
  animateLoop(scene, camera, composer, sphere, starField, state, world);
}

// --- Spectrum → scene parameter mapping -----------------------------------

function applySpectrumToParams(
  spectrum,
  { planetParams, radiusCtrl, bloomPass, material, sphere, baseRadius }
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

  const newRadius = baseRadius + lowAvg * 0.65;
  planetParams.radius = newRadius;
  if (radiusCtrl) radiusCtrl.setValue(newRadius);
  // Smooth lerp toward target scale instead of jumping
  const target = newRadius / baseRadius;
  const current = sphere.scale.x;
  const smoothed = current + (target - current) * 0.08;
  sphere.scale.setScalar(smoothed);

  bloomPass.strength = midAvg * 3;
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
  createStars,
  setupLights,
  setupGUI,
  setupInteractions,
  handleResize,
  animateLoop,
  initScene,
  applySpectrumToParams,
  createAudioState,
  stopAudio,
  toggleAudioPlayback,
  createAudioElement,
  loadAudioSource,
  setupPlanetClickHandler,
  createSongPickerDOM,
  setupSongPicker,
};
