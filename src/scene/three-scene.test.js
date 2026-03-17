// ensure a DOM is available for our helpers that touch `document`
// Vitest supports the jsdom environment via a top-of-file directive:
// https://vitest.dev/guide/environment.html#jsdom
/** @vitest-environment jsdom */

import { describe, it, expect, beforeEach, beforeAll, vi } from 'vitest';

// we need to stub WebGLRenderer because jsdom doesn't support WebGL contexts.
// Vitest can mock the three module before it's imported elsewhere.
vi.mock('/node_modules/three/build/three.module.js', async (importOriginal) => {
  // Partially mock three: import the real module and only replace WebGLRenderer.
  // Be defensive: if certain constants aren't present on the real module,
  // provide safe fallbacks so tests don't crash.
  const actual = await importOriginal();
  class FakeRenderer {
    constructor() {
      this.domElement = document.createElement('canvas');
      this.state = { buffers: { stencil: { setFunc: () => {} } } };
      this.autoClear = true;
      this.autoClearColor = true;
      this.autoClearDepth = true;
      this.autoClearStencil = true;
      this._clearAlpha = 1;
      this._clearColor = { set: () => {} };
    }
    setSize() {}
    setPixelRatio() {}
    getPixelRatio() { return 1; }
    getSize() { return { width: 0, height: 0 }; }
    getRenderTarget() { return null; }
    setRenderTarget() {}
    getContext() { return {}; }
    clear() {}
    render() {}
    getClearColor(target) {
      if (target && typeof target.set === 'function') target.set(0x000000);
      return this._clearColor;
    }
    getClearAlpha() { return this._clearAlpha; }
    setClearColor(color, alpha) { this._clearColor = color; if (alpha !== undefined) this._clearAlpha = alpha; }
    clearDepth() {}
  }

  // Safely expose constants if present, otherwise provide non-crashing defaults.
  const sRGBEncoding = Object.prototype.hasOwnProperty.call(actual, 'sRGBEncoding')
    ? actual.sRGBEncoding
    : 3000;
  const ACESFilmicToneMapping = Object.prototype.hasOwnProperty.call(actual, 'ACESFilmicToneMapping')
    ? actual.ACESFilmicToneMapping
    : 3001;

  return {
    ...actual,
    WebGLRenderer: FakeRenderer,
    sRGBEncoding,
    ACESFilmicToneMapping,
  };
});

import * as THREE from 'three';
import { setFlag } from '../config/feature-flags.js';
import {
  detectMobile,
  createCamera,
  createRenderer,
  setupPostProcessing,
  createSphere,
  createStars,
  setupLights,
  setupGUI,
  setupInteractions,
  setupPlanetFollowHandler,
  PLANET_DEFS,
  createPlanet,
  handleResize,
  animateLoop,
  initScene,
  applySpectrumToParams,
  createAudioState,
  stopAudio,
  toggleAudioPlayback,
  createAudioElement,
  createSongPickerDOM,
  setupPlanetClickHandler,
} from './three-scene.js';

// helper to make a fake container with dimensions
function makeContainer(w = 100, h = 50) {
  const c = document.createElement('div');
  Object.defineProperty(c, 'clientWidth', { value: w, configurable: true });
  Object.defineProperty(c, 'clientHeight', { value: h, configurable: true });
  document.body.appendChild(c);
  return c;
}

describe('three-scene helpers', () => {
  // provide a fake WebGLRenderer so tests run in jsdom without a real GL context
  beforeAll(() => {
    // jsdom lacks matchMedia which lil-gui checks during initialization
    if (typeof window.matchMedia !== 'function') {
      window.matchMedia = () => ({
        matches: false,
        addListener: () => {},
        removeListener: () => {},
      });
    }
  });
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  // ── detectMobile ──────────────────────────────────────────────────────

  describe('detectMobile', () => {
    it('returns a boolean', () => {
      expect(typeof detectMobile()).toBe('boolean');
    });

    it('consistently returns a boolean value (jsdom may report touch support)', () => {
      // jsdom versions may differ in maxTouchPoints; just verify it's a boolean
      const result = detectMobile();
      expect(result === true || result === false).toBe(true);
    });
  });

  // ── createCamera ──────────────────────────────────────────────────────

  describe('createCamera', () => {
    it('creates a PerspectiveCamera', () => {
      const c = makeContainer(200, 100);
      const cam = createCamera(c);
      expect(cam).toBeInstanceOf(THREE.PerspectiveCamera);
    });

    it('sets correct aspect ratio from container dimensions', () => {
      const c = makeContainer(200, 100);
      const cam = createCamera(c);
      expect(cam.aspect).toBeCloseTo(2);
    });

    it('uses 45-degree FOV', () => {
      const c = makeContainer();
      const cam = createCamera(c);
      expect(cam.fov).toBe(45);
    });

    it('positions camera at (0, 80, 300)', () => {
      const c = makeContainer();
      const cam = createCamera(c);
      expect(cam.position.x).toBe(0);
      expect(cam.position.y).toBe(80);
      expect(cam.position.z).toBe(300);
    });

    it('handles unusual aspect ratios (very wide)', () => {
      const c = makeContainer(1000, 100);
      const cam = createCamera(c);
      expect(cam.aspect).toBeCloseTo(10);
    });

    it('handles square containers', () => {
      const c = makeContainer(200, 200);
      const cam = createCamera(c);
      expect(cam.aspect).toBeCloseTo(1);
    });
  });

  // ── createRenderer ────────────────────────────────────────────────────

  describe('createRenderer', () => {
    it('appends canvas to container', () => {
      const c = makeContainer();
      const rend = createRenderer(c);
      expect(rend.domElement.parentElement).toBe(c);
    });

    it('caps pixel ratio at 2', () => {
      const c = makeContainer();
      const rend = createRenderer(c);
      expect(rend.getPixelRatio()).toBeLessThanOrEqual(2);
    });

    it('returns a renderer with a domElement', () => {
      const c = makeContainer();
      const rend = createRenderer(c);
      expect(rend.domElement).toBeInstanceOf(HTMLElement);
    });
  });

  // ── setupPostProcessing ───────────────────────────────────────────────

  describe('setupPostProcessing', () => {
    it('returns composer and bloomPass', () => {
      const c = makeContainer();
      const scene = new THREE.Scene();
      const cam = createCamera(c);
      const rend = createRenderer(c);
      const { composer, bloomPass } = setupPostProcessing(rend, scene, cam, c);
      expect(composer).toBeDefined();
      expect(bloomPass).toBeDefined();
    });

    it('adds at least 2 passes (render + bloom)', () => {
      const c = makeContainer();
      const scene = new THREE.Scene();
      const cam = createCamera(c);
      const rend = createRenderer(c);
      const { composer } = setupPostProcessing(rend, scene, cam, c);
      expect(composer.passes.length).toBeGreaterThanOrEqual(2);
    });

    it('bloomPass has strength, radius, and threshold properties', () => {
      const c = makeContainer();
      const scene = new THREE.Scene();
      const cam = createCamera(c);
      const rend = createRenderer(c);
      const { bloomPass } = setupPostProcessing(rend, scene, cam, c);
      expect(bloomPass).toHaveProperty('strength');
      expect(bloomPass).toHaveProperty('radius');
      expect(bloomPass).toHaveProperty('threshold');
    });
  });

  // ── createSphere ──────────────────────────────────────────────────────

  describe('createSphere', () => {
    it('returns mesh and material', () => {
      const { sphere, material } = createSphere(false);
      expect(sphere).toBeInstanceOf(THREE.Mesh);
      expect(material).toBeInstanceOf(THREE.MeshPhysicalMaterial);
    });

    it('sphere has SphereGeometry', () => {
      const { sphere } = createSphere(false);
      expect(sphere.geometry).toBeInstanceOf(THREE.SphereGeometry);
    });

    it('uses MeshPhysicalMaterial with blue color', () => {
      const { material } = createSphere(false);
      // accent color 0x60a5fa
      expect(material.color.getHex()).toBe(0x60a5fa);
    });

    it('desktop version uses 64 segments', () => {
      const { sphere } = createSphere(false);
      // SphereGeometry stores widthSegments in parameters
      const params = sphere.geometry.parameters;
      expect(params.widthSegments).toBe(64);
      expect(params.heightSegments).toBe(64);
    });

    it('mobile version uses fewer segments for performance', () => {
      const { sphere } = createSphere(true);
      const params = sphere.geometry.parameters;
      expect(params.widthSegments).toBe(32);
      expect(params.heightSegments).toBe(32);
    });

    it('material has PBR properties set', () => {
      const { material } = createSphere(false);
      expect(material.metalness).toBe(0.2);
      expect(material.roughness).toBe(0.7);
      expect(material.clearcoat).toBe(0.5);
    });
  });

  // ── createStars ───────────────────────────────────────────────────────

  describe('createStars', () => {
    it('returns Points object', () => {
      const pts = createStars(false);
      expect(pts).toBeInstanceOf(THREE.Points);
    });

    it('has position attribute with vertices', () => {
      const pts = createStars(false);
      const attr = pts.geometry.getAttribute('position');
      expect(attr.count).toBeGreaterThan(0);
    });

    it('desktop uses 3000 stars', () => {
      const pts = createStars(false);
      const attr = pts.geometry.getAttribute('position');
      expect(attr.count).toBe(3000);
    });

    it('mobile uses 1200 stars for performance', () => {
      const pts = createStars(true);
      const attr = pts.geometry.getAttribute('position');
      expect(attr.count).toBe(1200);
    });

    it('star material has white color', () => {
      const pts = createStars(false);
      expect(pts.material.color.getHex()).toBe(0xffffff);
    });

    it('star material is transparent', () => {
      const pts = createStars(false);
      expect(pts.material.transparent).toBe(true);
    });

    it('all star positions are at distance >= 200 from origin', () => {
      const pts = createStars(false);
      const positions = pts.geometry.getAttribute('position');
      for (let i = 0; i < positions.count; i++) {
        const x = positions.getX(i);
        const y = positions.getY(i);
        const z = positions.getZ(i);
        const dist = Math.sqrt(x * x + y * y + z * z);
        expect(dist).toBeGreaterThanOrEqual(199);
      }
    });
  });

  // ── setupLights ───────────────────────────────────────────────────────

  describe('setupLights', () => {
    it('adds multiple light sources to the scene', () => {
      const scene = new THREE.Scene();
      setupLights(scene);
      expect(scene.children.length).toBeGreaterThanOrEqual(3);
    });

    it('includes a point light (sun light)', () => {
      const scene = new THREE.Scene();
      setupLights(scene);
      const ptLight = scene.children.find((c) => c instanceof THREE.PointLight);
      expect(ptLight).toBeDefined();
    });

    it('includes an ambient light', () => {
      const scene = new THREE.Scene();
      setupLights(scene);
      const ambLight = scene.children.find((c) => c instanceof THREE.AmbientLight);
      expect(ambLight).toBeDefined();
    });

    it('includes a hemisphere light', () => {
      const scene = new THREE.Scene();
      setupLights(scene);
      const hemiLight = scene.children.find((c) => c instanceof THREE.HemisphereLight);
      expect(hemiLight).toBeDefined();
    });
  });

  // ── setupGUI ──────────────────────────────────────────────────────────

  describe('setupGUI', () => {
    it('inserts lil-gui dom element into the document', () => {
      const fakeMat = new THREE.MeshPhysicalMaterial();
      const fakeBloom = { strength: 1, radius: 0.5, threshold: 0.2 };
      const fakeStars = new THREE.Object3D();
      setupGUI(fakeMat, fakeBloom, fakeStars);
      const guiEl = document.querySelector('.lil-gui');
      expect(guiEl).not.toBeNull();
    });

    it('returns gui and effects folder', () => {
      const fakeMat = new THREE.MeshPhysicalMaterial();
      const fakeBloom = { strength: 1, radius: 0.5, threshold: 0.2 };
      const fakeStars = new THREE.Object3D();
      const result = setupGUI(fakeMat, fakeBloom, fakeStars);
      expect(result).toHaveProperty('gui');
      expect(result).toHaveProperty('effects');
    });
  });

  // ── setupInteractions ─────────────────────────────────────────────────

  describe('setupInteractions', () => {
    it('returns state object with expected properties', () => {
      const c = makeContainer();
      const cam = createCamera(c);
      const state = setupInteractions(c, cam);
      expect(state).toHaveProperty('targetCam');
      expect(state).toHaveProperty('mouseX');
      expect(state).toHaveProperty('mouseY');
      expect(state).toHaveProperty('targetZ');
    });

    it('initialises mouseX and mouseY to zero', () => {
      const c = makeContainer();
      const cam = createCamera(c);
      const state = setupInteractions(c, cam);
      expect(state.mouseX).toBe(0);
      expect(state.mouseY).toBe(0);
    });

    it('responds to mousemove for camera look direction', () => {
      const c = makeContainer();
      const cam = createCamera(c);
      const state = setupInteractions(c, cam);
      expect(state.mouseX).toBe(0);
      // Simulate mousemove over container
      c.getBoundingClientRect = () => ({ left: 0, top: 0, width: 800, height: 600 });
      c.dispatchEvent(new MouseEvent('mousemove', { clientX: 600, clientY: 300 }));
      expect(state.mouseX).not.toBe(0);
    });

    it('responds to wheel events by moving camera', () => {
      const c = makeContainer();
      const cam = createCamera(c);
      const state = setupInteractions(c, cam);
      const initialZ = cam.position.z;
      const w = new WheelEvent('wheel', { deltaY: 100 });
      window.dispatchEvent(w);
      expect(cam.position.z).not.toBe(initialZ);
    });

    it('responds to WASD key events', () => {
      const c = makeContainer();
      const cam = createCamera(c);
      const state = setupInteractions(c, cam);
      expect(state.keys.w).toBe(false);
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'w' }));
      expect(state.keys.w).toBe(true);
      window.dispatchEvent(new KeyboardEvent('keyup', { key: 'w' }));
      expect(state.keys.w).toBe(false);
    });

    it('targetCam is a THREE.Vector3', () => {
      const c = makeContainer();
      const cam = createCamera(c);
      const state = setupInteractions(c, cam);
      expect(state.targetCam).toBeInstanceOf(THREE.Vector3);
    });
  });

  // ── handleResize ──────────────────────────────────────────────────────

  describe('handleResize', () => {
    it('updates camera aspect ratio', () => {
      const c = makeContainer(300, 150);
      const cam = createCamera(c);
      cam.aspect = 1; // force wrong aspect
      const rend = createRenderer(c);
      const dummyComposer = { setSize: vi.fn() };
      handleResize(c, cam, rend, dummyComposer);
      expect(cam.aspect).toBeCloseTo(2); // 300/150
    });

    it('calls composer.setSize with container dimensions', () => {
      const c = makeContainer(300, 150);
      const cam = createCamera(c);
      const rend = createRenderer(c);
      const dummyComposer = { setSize: vi.fn() };
      handleResize(c, cam, rend, dummyComposer);
      expect(dummyComposer.setSize).toHaveBeenCalledWith(300, 150);
    });
  });

  // ── animateLoop ───────────────────────────────────────────────────────

  describe('animateLoop', () => {
    it('runs without throwing and calls composer.render', () => {
      const scene = new THREE.Scene();
      const c = makeContainer();
      const cam = createCamera(c);
      const rend = createRenderer(c);
      const { composer } = setupPostProcessing(rend, scene, cam, c);
      const { sphere } = createSphere(false);
      const stars = createStars(false);
      scene.add(sphere, stars);
      const planet = { mesh: sphere, pivot: new THREE.Group(), def: { speed: 0.3 } };
      const state = { targetCam: new THREE.Vector3(), mouseX: 0, mouseY: 0, targetZ: cam.position.z, keys: { w: false, a: false, s: false, d: false, q: false, e: false }, moveSpeed: 30, followPlanet: null };
      const spy = vi.spyOn(composer, 'render');
      vi.useFakeTimers();
      try {
        animateLoop(scene, cam, composer, [planet], stars, state);
        vi.advanceTimersByTime(50);
        expect(spy).toHaveBeenCalled();
      } finally {
        vi.useRealTimers();
      }
    });

    it('rotates a planet over time', () => {
      const scene = new THREE.Scene();
      const c = makeContainer();
      const cam = createCamera(c);
      const rend = createRenderer(c);
      const { composer } = setupPostProcessing(rend, scene, cam, c);
      const { sphere } = createSphere(false);
      const stars = createStars(false);
      scene.add(sphere, stars);
      const planet = { mesh: sphere, pivot: new THREE.Group(), def: { speed: 0.3 } };
      const state = { targetCam: new THREE.Vector3(), mouseX: 0, mouseY: 0, targetZ: cam.position.z, keys: { w: false, a: false, s: false, d: false, q: false, e: false }, moveSpeed: 30, followPlanet: null };
      const initialYRot = sphere.rotation.y;
      vi.useFakeTimers();
      try {
        animateLoop(scene, cam, composer, [planet], stars, state);
        vi.advanceTimersByTime(100);
        expect(sphere.rotation.y).not.toBe(initialYRot);
      } finally {
        vi.useRealTimers();
      }
    });

    it('moves camera with WASD keys', () => {
      const scene = new THREE.Scene();
      const c = makeContainer();
      const cam = createCamera(c);
      const rend = createRenderer(c);
      const { composer } = setupPostProcessing(rend, scene, cam, c);
      const { sphere } = createSphere(false);
      const stars = createStars(false);
      scene.add(sphere, stars);
      const planet = { mesh: sphere, pivot: new THREE.Group(), def: { speed: 0.3 } };
      const state = { targetCam: new THREE.Vector3(), mouseX: 0, mouseY: 0, targetZ: cam.position.z, keys: { w: true, a: false, s: false, d: false, q: false, e: false }, moveSpeed: 30, followPlanet: null };
      const initialZ = cam.position.z;
      vi.useFakeTimers();
      try {
        animateLoop(scene, cam, composer, [planet], stars, state);
        vi.advanceTimersByTime(100);
        // Camera z should have changed from W key press
        expect(cam.position.z).not.toBe(initialZ);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  // ── initScene ────────────────────────────────────────────────────────

  describe('initScene', () => {
    it('respects feature flags by hiding GUI and upload when disabled', () => {
      setFlag('ENABLE_GUI', false);
      setFlag('ENABLE_UPLOAD', false);
      const c = makeContainer();
      c.id = 'three-container';
      initScene();
      expect(document.querySelector('.lil-gui')).toBeNull();
      expect(c.querySelector('input[type=file]')).toBeNull();
      setFlag('ENABLE_GUI', true);
      setFlag('ENABLE_UPLOAD', true);
    });

    it('does nothing when #three-container is missing', () => {
      // no container in DOM
      expect(() => initScene()).not.toThrow();
    });

    it('appends a canvas element to the container', () => {
      setFlag('ENABLE_GUI', false);
      setFlag('ENABLE_UPLOAD', false);
      const c = makeContainer();
      c.id = 'three-container';
      initScene();
      expect(c.querySelector('canvas')).not.toBeNull();
      setFlag('ENABLE_GUI', true);
      setFlag('ENABLE_UPLOAD', true);
    });
  });

  // ── applySpectrumToParams ─────────────────────────────────────────────

  describe('applySpectrumToParams', () => {
    it('updates radius based on low frequency average', () => {
      const planetParams = { radius: 1 };
      const radiusCtrl = { setValue: vi.fn() };
      const bloomPass = { strength: 0, threshold: 0 };
      const material = { reflectivity: 0 };
      const sphere = { scale: { x: 1, setScalar: vi.fn() } };
      const baseRadius = 1;
      // low frequencies are all 1.0
      const spectrum = new Float32Array([1, 1, 1, 0.5, 0.5, 0, 0]);
      applySpectrumToParams(spectrum, { planetParams, radiusCtrl, bloomPass, material, sphere, baseRadius });
      // lowAvg = avg of first two elements = 1
      expect(planetParams.radius).toBeCloseTo(1 + 1 * 0.65); // baseRadius + lowAvg * 0.65
      expect(radiusCtrl.setValue).toHaveBeenCalledWith(1.65);
      // lerp from current (1) toward target (1.65) with factor 0.08
      expect(sphere.scale.setScalar).toHaveBeenCalledWith(expect.closeTo(1 + (1.65 - 1) * 0.08, 4));
    });

    it('updates bloom strength from mid frequency average', () => {
      const planetParams = { radius: 1 };
      const radiusCtrl = { setValue: vi.fn() };
      const bloomPass = { strength: 0, threshold: 0 };
      const material = { reflectivity: 0 };
      const sphere = { scale: { x: 1, setScalar: vi.fn() } };
      const baseRadius = 1;
      const spectrum = new Float32Array([1, 1, 1, 0.5, 0.5, 0, 0]);
      applySpectrumToParams(spectrum, { planetParams, radiusCtrl, bloomPass, material, sphere, baseRadius });
      // midAvg = avg of elements at indices 2,3 = (1+0.5)/2 = 0.75
      expect(bloomPass.strength).toBeCloseTo(0.75 * 3);
    });

    it('updates bloom threshold from high frequency average', () => {
      const planetParams = { radius: 1 };
      const radiusCtrl = { setValue: vi.fn() };
      const bloomPass = { strength: 0, threshold: 0 };
      const material = { reflectivity: 0 };
      const sphere = { scale: { x: 1, setScalar: vi.fn() } };
      const baseRadius = 1;
      const spectrum = new Float32Array([1, 1, 1, 0.5, 0.5, 0, 0]);
      applySpectrumToParams(spectrum, { planetParams, radiusCtrl, bloomPass, material, sphere, baseRadius });
      // highAvg = avg of elements at indices 4,5,6 = (0.5+0+0)/3
      expect(bloomPass.threshold).toBeCloseTo((0.5 + 0 + 0) / 3);
    });

    it('updates material reflectivity from high frequency', () => {
      const planetParams = { radius: 1 };
      const radiusCtrl = { setValue: vi.fn() };
      const bloomPass = { strength: 0, threshold: 0 };
      const material = { reflectivity: 0 };
      const sphere = { scale: { x: 1, setScalar: vi.fn() } };
      const baseRadius = 1;
      const spectrum = new Float32Array([1, 1, 1, 0.5, 0.5, 0, 0]);
      applySpectrumToParams(spectrum, { planetParams, radiusCtrl, bloomPass, material, sphere, baseRadius });
      const highAvg = (0.5 + 0 + 0) / 3;
      expect(material.reflectivity).toBeCloseTo(0.2 + highAvg * 0.8);
    });

    it('handles all-zero spectrum', () => {
      const planetParams = { radius: 1 };
      const radiusCtrl = { setValue: vi.fn() };
      const bloomPass = { strength: 0, threshold: 0 };
      const material = { reflectivity: 0 };
      const sphere = { scale: { x: 1, setScalar: vi.fn() } };
      const baseRadius = 0.9;
      const spectrum = new Float32Array(12); // all zeros
      applySpectrumToParams(spectrum, { planetParams, radiusCtrl, bloomPass, material, sphere, baseRadius });
      // with all zeros: radius = baseRadius, bloom = 0, reflectivity = 0.2
      expect(planetParams.radius).toBeCloseTo(0.9);
      expect(bloomPass.strength).toBeCloseTo(0);
      expect(material.reflectivity).toBeCloseTo(0.2);
    });

    it('handles all-one spectrum (max levels)', () => {
      const planetParams = { radius: 1 };
      const radiusCtrl = { setValue: vi.fn() };
      const bloomPass = { strength: 0, threshold: 0 };
      const material = { reflectivity: 0 };
      const sphere = { scale: { x: 1, setScalar: vi.fn() } };
      const baseRadius = 0.9;
      const spectrum = new Float32Array(12).fill(1.0);
      applySpectrumToParams(spectrum, { planetParams, radiusCtrl, bloomPass, material, sphere, baseRadius });
      expect(planetParams.radius).toBeCloseTo(0.9 + 1 * 0.65); // 1.55
      expect(bloomPass.strength).toBeCloseTo(3);
      expect(bloomPass.threshold).toBeCloseTo(1);
      expect(material.reflectivity).toBeCloseTo(1.0);
    });

    it('works without radiusCtrl (null)', () => {
      const planetParams = { radius: 1 };
      const bloomPass = { strength: 0, threshold: 0 };
      const material = { reflectivity: 0 };
      const sphere = { scale: { x: 1, setScalar: vi.fn() } };
      const baseRadius = 1;
      const spectrum = new Float32Array([0.5, 0.5, 0.5]);
      // should not throw when radiusCtrl is null
      expect(() => {
        applySpectrumToParams(spectrum, { planetParams, radiusCtrl: null, bloomPass, material, sphere, baseRadius });
      }).not.toThrow();
    });

    it('does not throw with minimal spectrum', () => {
      const planetParams = { radius: 1 };
      const bloomPass = { strength: 0, threshold: 0 };
      const material = { reflectivity: 0 };
      const sphere = { scale: { x: 1, setScalar: vi.fn() } };
      expect(() => {
        applySpectrumToParams(new Float32Array([0.5]), {
          planetParams, radiusCtrl: null, bloomPass, material, sphere, baseRadius: 1,
        });
      }).not.toThrow();
    });
  });

  // ── createAudioState ────────────────────────────────────────────────

  describe('createAudioState', () => {
    it('returns object with null stream, fft, and audioEl', () => {
      const s = createAudioState();
      expect(s).toEqual({ stream: null, fft: null, audioEl: null });
    });

    it('returns a fresh object each call', () => {
      const a = createAudioState();
      const b = createAudioState();
      expect(a).not.toBe(b);
    });
  });

  // ── stopAudio ─────────────────────────────────────────────────────────

  describe('stopAudio', () => {
    it('stops and nullifies stream', () => {
      const stream = { stop: vi.fn() };
      const state = { stream, fft: null, audioEl: null };
      stopAudio(state);
      expect(stream.stop).toHaveBeenCalled();
      expect(state.stream).toBeNull();
    });

    it('pauses and nullifies audioEl', () => {
      const audioEl = { pause: vi.fn() };
      const state = { stream: null, fft: null, audioEl };
      stopAudio(state);
      expect(audioEl.pause).toHaveBeenCalled();
      expect(state.audioEl).toBeNull();
    });

    it('handles both stream and audioEl together', () => {
      const stream = { stop: vi.fn() };
      const audioEl = { pause: vi.fn() };
      const state = { stream, fft: null, audioEl };
      stopAudio(state);
      expect(stream.stop).toHaveBeenCalled();
      expect(audioEl.pause).toHaveBeenCalled();
      expect(state.stream).toBeNull();
      expect(state.audioEl).toBeNull();
    });

    it('does nothing when state is already clean', () => {
      const state = createAudioState();
      expect(() => stopAudio(state)).not.toThrow();
    });

    it('swallows errors from audioEl.pause()', () => {
      const audioEl = { pause: () => { throw new Error('fail'); } };
      const state = { stream: null, fft: null, audioEl };
      expect(() => stopAudio(state)).not.toThrow();
      expect(state.audioEl).toBeNull();
    });
  });

  // ── toggleAudioPlayback ───────────────────────────────────────────────

  describe('toggleAudioPlayback', () => {
    it('returns false when no audioEl is set', async () => {
      const state = createAudioState();
      const result = await toggleAudioPlayback(state);
      expect(result).toBe(false);
    });

    it('plays paused audio and starts stream, returns true', async () => {
      const audioEl = { paused: true, play: vi.fn().mockResolvedValue(undefined) };
      const stream = { start: vi.fn(), stop: vi.fn() };
      const state = { stream, fft: null, audioEl };
      const result = await toggleAudioPlayback(state);
      expect(result).toBe(true);
      expect(audioEl.play).toHaveBeenCalled();
      expect(stream.start).toHaveBeenCalled();
    });

    it('pauses playing audio and stops stream, returns false', async () => {
      const audioEl = { paused: false, pause: vi.fn() };
      const stream = { start: vi.fn(), stop: vi.fn() };
      const state = { stream, fft: null, audioEl };
      const result = await toggleAudioPlayback(state);
      expect(result).toBe(false);
      expect(audioEl.pause).toHaveBeenCalled();
      expect(stream.stop).toHaveBeenCalled();
    });

    it('resumes suspended AudioContext before playing', async () => {
      const resume = vi.fn().mockResolvedValue(undefined);
      const audioEl = { paused: true, play: vi.fn().mockResolvedValue(undefined) };
      const fft = { context: { state: 'suspended', resume } };
      const state = { stream: null, fft, audioEl };
      await toggleAudioPlayback(state);
      expect(resume).toHaveBeenCalled();
    });

    it('does not resume context if already running', async () => {
      const resume = vi.fn();
      const audioEl = { paused: true, play: vi.fn().mockResolvedValue(undefined) };
      const fft = { context: { state: 'running', resume } };
      const state = { stream: null, fft, audioEl };
      await toggleAudioPlayback(state);
      expect(resume).not.toHaveBeenCalled();
    });
  });

  // ── createAudioElement ────────────────────────────────────────────────

  describe('createAudioElement', () => {
    it('creates an audio element with the given src', () => {
      const el = createAudioElement('test.mp3');
      expect(el.tagName).toBe('AUDIO');
      expect(el.src).toContain('test.mp3');
    });

    it('sets crossOrigin to anonymous', () => {
      const el = createAudioElement('test.mp3');
      expect(el.crossOrigin).toBe('anonymous');
    });

    it('disables controls and sets preload auto', () => {
      const el = createAudioElement('test.mp3');
      expect(el.controls).toBe(false);
      expect(el.preload).toBe('auto');
    });
  });

  // ── createSongPickerDOM ─────────────────────────────────────────────

  describe('createSongPickerDOM', () => {
    it('returns wrapper with folderLabel and driveFilesList', () => {
      const dom = createSongPickerDOM();
      expect(dom.wrapper).toBeInstanceOf(HTMLElement);
      expect(dom.folderLabel).toBeInstanceOf(HTMLSpanElement);
      expect(dom.driveFilesList).toBeInstanceOf(HTMLSelectElement);
    });

    it('wrapper contains folderLabel and driveFilesList', () => {
      const dom = createSongPickerDOM();
      expect(dom.wrapper.contains(dom.folderLabel)).toBe(true);
      expect(dom.wrapper.contains(dom.driveFilesList)).toBe(true);
    });

    it('drive files dropdown is initially hidden', () => {
      const dom = createSongPickerDOM();
      expect(dom.driveFilesList.style.display).toBe('none');
    });

    it('folder label defaults to "Folder: none"', () => {
      const dom = createSongPickerDOM();
      expect(dom.folderLabel.textContent).toBe('Folder: none');
    });
  });

  // ── setupPlanetClickHandler ───────────────────────────────────────────

  describe('setupPlanetClickHandler', () => {
    it('registers a click handler on the renderer domElement', () => {
      const c = makeContainer();
      const cam = createCamera(c);
      const rend = createRenderer(c);
      const { sphere } = createSphere(false);
      const audioState = createAudioState();
      const spy = vi.spyOn(rend.domElement, 'addEventListener');
      setupPlanetClickHandler(rend, cam, sphere, audioState);
      expect(spy).toHaveBeenCalledWith('click', expect.any(Function));
    });
  });

  // ── setupPlanetFollowHandler ──────────────────────────────────────────

  describe('setupPlanetFollowHandler', () => {
    it('registers a click handler on the renderer domElement', () => {
      const c = makeContainer();
      const cam = createCamera(c);
      const rend = createRenderer(c);
      const planets = PLANET_DEFS.map((def) => createPlanet(def, true));
      const state = { followPlanet: null, zoomActive: false };
      const spy = vi.spyOn(rend.domElement, 'addEventListener');
      setupPlanetFollowHandler(rend, cam, planets, state);
      expect(spy).toHaveBeenCalledWith('click', expect.any(Function));
    });
  });
});
