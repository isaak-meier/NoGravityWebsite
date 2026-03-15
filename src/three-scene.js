// Import ES module build from node_modules so the browser can resolve it when served statically
import * as THREE from "/node_modules/three/build/three.module.js";
import { EffectComposer } from "/node_modules/three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "/node_modules/three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "/node_modules/three/examples/jsm/postprocessing/UnrealBloomPass.js";
// GUI library for runtime tweaking
import GUI from "/node_modules/lil-gui/dist/lil-gui.esm.min.js";
import AudioFFT from "./audio-fft.js";
import { isEnabled } from "./feature-flags.js";
import appConfig from "./app-config.js";
import {
  initializeGoogleAuth,
  requestGoogleAuth,
  showGoogleDrivePicker,
  getAccessToken,
} from "./google-auth.js";
import GoogleDriveAudioProvider from "./google-drive-audio.js";

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

function animateLoop(scene, camera, composer, sphere, starField, state) {
  const clock = new THREE.Clock();
  (function tick() {
    requestAnimationFrame(tick);
    const t = clock.getDelta();
    sphere.rotation.y += t * 0.2;
    sphere.rotation.x += t * 0.08;
    starField.rotation.y += t * 0.002;
    state.targetCam.x = state.mouseX * 0.8;
    state.targetCam.y = -state.mouseY * 0.6;
    camera.position.x += (state.targetCam.x - camera.position.x) * 0.06;
    camera.position.y += (state.targetCam.y - camera.position.y) * 0.06;
    camera.position.z += (state.targetZ - camera.position.z) * 0.06;
    camera.lookAt(0, 0, 0);
    composer.render();
  })();
}

function initScene() {
  cleanupDevServiceWorkers();

  const container = document.getElementById("three-container");
  if (!container) {
    console.warn("No #three-container found");
    return;
  }
  const scene = new THREE.Scene();
  // start slightly further back for a more zoomed-out view
  const camera = createCamera(container);
  camera.position.z = 7;
  const isMobile = detectMobile();
  const renderer = createRenderer(container);
  const { composer, bloomPass } = setupPostProcessing(
    renderer,
    scene,
    camera,
    container
  );
  const { sphere, material } = createSphere(isMobile);
  scene.add(sphere);
  const starField = createStars(isMobile);
  scene.add(starField);
  setupLights(scene);
  let gui, effects;
  if (isEnabled("ENABLE_GUI")) {
    ({ gui, effects } = setupGUI(material, bloomPass, starField));
  }
  // add a radius controller (scales the sphere) inside the effects folder
  const baseRadius = 0.9;
  const planetParams = { radius: baseRadius };
  let radiusCtrl = null;
  if (effects) {
    radiusCtrl = effects.add(planetParams, "radius", 0.2, 2);
    radiusCtrl.onChange((v) => sphere.scale.setScalar(v / baseRadius));
  }

  if (isEnabled("ENABLE_UPLOAD")) {
    // Initialize Google Auth on page load
    initializeGoogleAuth();

    // audio controls: file input + play/sync + google drive
    const audioControls = document.createElement("div");
    audioControls.style.cssText = "position: absolute; bottom: 12px; left: 12px; z-index:20; background: rgba(0,0,0,0.4); padding:8px; border-radius:6px; color:#e6eef8; font-size:12px;";
    const fileIn = document.createElement("input");
    fileIn.type = "file";
    fileIn.accept = "audio/*";
    const playBtn = document.createElement("button");
    playBtn.textContent = "Play";
    playBtn.style.marginLeft = "8px";
    const pickerBtn = document.createElement("button");
    pickerBtn.textContent = "Open Picker";
    pickerBtn.style.marginLeft = "8px";
    const folderLabel = document.createElement("span");
    folderLabel.style.cssText = "margin-left: 8px; opacity: 0.9;";
    folderLabel.textContent = "Folder: none";
    
    // Dropdown to select audio files from Google Drive
    const driveFilesList = document.createElement("select");
    driveFilesList.style.cssText = "margin-left: 8px; display: none;";
    driveFilesList.appendChild(new Option("Select an audio file...", ""));
    
    audioControls.appendChild(fileIn);
    audioControls.appendChild(playBtn);
    audioControls.appendChild(pickerBtn);
    audioControls.appendChild(folderLabel);
    audioControls.appendChild(driveFilesList);
    container.appendChild(audioControls);

    let currentStream = null;
    let currentFFT = null;
    let currentAudioEl = null;
    let currentDriveProvider = null;
    const presetFolderId =
      appConfig.googleDrive.folderId ||
      (typeof window !== "undefined"
        ? window.__GOOGLE_DRIVE_FOLDER_ID__
        : null);
    const presetApiKey =
      appConfig.googleDrive.apiKey ||
      (typeof window !== "undefined" ? window.__GOOGLE_API_KEY__ : null);

    function stopCurrentAudio() {
      if (currentStream) {
        currentStream.stop();
        currentStream = null;
      }
      if (currentAudioEl) {
        try {
          currentAudioEl.pause();
        } catch (err) {}
        currentAudioEl = null;
      }
    }

    async function loadDriveFileById(fileId) {
      if (!fileId || !currentDriveProvider) return;

      stopCurrentAudio();

      // Fetch audio as blob with proper auth headers so private Drive files work
      const blob = await currentDriveProvider.fetchFileBlob(fileId);
      const blobUrl = URL.createObjectURL(blob);
      const audioEl = document.createElement("audio");
      audioEl.src = blobUrl;
      audioEl.crossOrigin = "anonymous";
      audioEl.controls = false;
      audioEl.preload = "auto";
      currentAudioEl = audioEl;

      currentFFT = new AudioFFT({ audioElement: audioEl, context: null });
      try {
        await currentFFT.load();
      } catch (err) {
        console.warn("AudioFFT.load() failed:", err);
      }

      const stream = currentFFT.createStream();
      stream.onData((spectrum) => {
        applySpectrumToParams(spectrum, {
          planetParams,
          radiusCtrl,
          bloomPass,
          material,
          sphere,
          baseRadius,
        });
      });
      currentStream = stream;

      try {
        await audioEl.play();
        if (currentStream) currentStream.start();
      } catch (err) {
        console.warn("Auto-play failed:", err);
      }
    }

    async function connectDriveProvider(provider, {
      folderNameHint = "Unnamed folder",
      autoSelectFirst = false,
    } = {}) {
      currentDriveProvider = provider;
      folderLabel.textContent = `Folder: ${folderNameHint}`;

      try {
        const folder = await currentDriveProvider.getFolder();
        if (folder && folder.name) {
          folderLabel.textContent = `Folder: ${folder.name}`;
        }
      } catch (err) {
        console.warn("Unable to fetch folder name from Drive API:", err);
      }

      const files = await currentDriveProvider.listFiles();
      if (files.length === 0) {
        alert("No audio files found in the selected folder");
        return;
      }

      driveFilesList.innerHTML = '<option value="">Select an audio file...</option>';
      files.forEach((file) => {
        const option = new Option(file.name, file.id);
        driveFilesList.appendChild(option);
      });
      driveFilesList.style.display = "inline-block";

      if (autoSelectFirst) {
        driveFilesList.value = files[0].id;
        await loadDriveFileById(files[0].id);
      }
    }

    // Google Drive Picker button handler
    pickerBtn.addEventListener("click", async () => {
      try {
        // Step 1: Request Google auth
        const token = await requestGoogleAuth();
        if (!token) {
          console.warn("Failed to get Google auth token");
          return;
        }

        // Step 2: Show folder picker
        const selectedFolder = await showGoogleDrivePicker();
        if (!selectedFolder || !selectedFolder.id) {
          console.log("User cancelled folder selection");
          return;
        }

        const folderId = selectedFolder.id;
        const pickerFolderName = selectedFolder.name || "Unnamed folder";
        const provider = new GoogleDriveAudioProvider({
          folderId,
          accessToken: token,
        });

        await connectDriveProvider(provider, {
          folderNameHint: pickerFolderName,
          autoSelectFirst: false,
        });
      } catch (err) {
        console.error("Google Drive error:", err);
        alert("Error accessing Google Drive: " + err.message);
      }
    });

    // Handle selection from Google Drive dropdown
    driveFilesList.addEventListener("change", async (e) => {
      const fileId = e.target.value;
      if (!fileId || !currentDriveProvider) return;

      try {
        await loadDriveFileById(fileId);
      } catch (err) {
        console.error("Error loading audio from Drive:", err);
        alert("Error loading audio: " + err.message);
      }
    });

    if (presetFolderId) {
      pickerBtn.textContent = "Change Folder";
      const provider = new GoogleDriveAudioProvider({
        folderId: presetFolderId,
        apiKey: presetApiKey || null,
      });

      connectDriveProvider(provider, {
        folderNameHint: "Configured folder",
        autoSelectFirst: true,
      }).catch((err) => {
        console.error("Configured Google Drive folder failed:", err);
        folderLabel.textContent = "Folder: unavailable";
      });
    }

    fileIn.addEventListener("change", async (e) => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    stopCurrentAudio();
    const url = URL.createObjectURL(f);
    const audioEl = document.createElement("audio");
    audioEl.src = url;
    audioEl.crossOrigin = "anonymous";
    audioEl.controls = false;
    audioEl.preload = "auto";
    currentAudioEl = audioEl;
    // instantiate helper
    currentFFT = new AudioFFT({ audioElement: audioEl, context: null });
    // prefer reuse of existing AudioContext if AudioFFT created one internally; load() will create analyser
    try {
      await currentFFT.load();
    } catch (err) {
      console.warn("AudioFFT.load() failed:", err);
    }
    const stream = currentFFT.createStream();
    stream.onData((spectrum) => {
      applySpectrumToParams(spectrum, {
        planetParams,
        radiusCtrl,
        bloomPass,
        material,
        sphere,
        baseRadius,
      });
    });
    currentStream = stream;
  });

  playBtn.addEventListener("click", async () => {
    if (!currentAudioEl) return;
    try {
      await currentAudioEl.play();
    } catch (err) {
      try {
        // try resuming context and play again
        if (currentFFT && currentFFT.context && currentFFT.context.state === "suspended") await currentFFT.context.resume();
        await currentAudioEl.play();
      } catch (e) {
        console.warn("Audio play failed:", e);
      }
    }
    if (currentStream) currentStream.start();
  });
  }
  const state = setupInteractions(container, camera);
  window.addEventListener("resize", () =>
    handleResize(container, camera, renderer, composer)
  );
  animateLoop(scene, camera, composer, sphere, starField, state);
}

// helper used to map FFT data into scene parameters
function applySpectrumToParams(
  spectrum,
  { planetParams, radiusCtrl, bloomPass, material, sphere, baseRadius }
) {
  const len = spectrum.length;
  // divide into low/mid/high thirds
  const third = Math.floor(len / 3);
  const low = spectrum.slice(0, third);
  const mid = spectrum.slice(third, third * 2);
  const high = spectrum.slice(third * 2);

  const avg = (arr) => (arr.reduce((a, v) => a + v, 0) / arr.length) || 0;
  const lowAvg = avg(low);
  const midAvg = avg(mid);
  const highAvg = avg(high);

  // radius: base + lowAvg*1.2
  const newRadius = baseRadius + lowAvg * 1.2;
  planetParams.radius = newRadius;
  if (radiusCtrl) {
    radiusCtrl.setValue(newRadius);
  }
  sphere.scale.setScalar(newRadius / baseRadius);

  // bloom strength: map midAvg to [0,3]
  bloomPass.strength = midAvg * 3;
  // threshold: map highAvg to [0,1]
  bloomPass.threshold = highAvg;

  // material reflectivity or clearcoat based on high freq
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
};
