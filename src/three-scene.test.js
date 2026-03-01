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

import * as THREE from '/node_modules/three/build/three.module.js';
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
  handleResize,
  animateLoop,
  initScene,
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

  it('detectMobile returns boolean', () => {
    expect(typeof detectMobile()).toBe('boolean');
  });

  it('createCamera creates a camera with correct aspect', () => {
    const c = makeContainer(200, 100);
    const cam = createCamera(c);
    expect(cam).toBeInstanceOf(THREE.PerspectiveCamera);
    expect(cam.aspect).toBeCloseTo(2);
  });

  it('createRenderer appends canvas to container', () => {
    const c = makeContainer();
    const rend = createRenderer(c);
    expect(rend.domElement.parentElement).toBe(c);
    expect(rend.getPixelRatio()).toBeLessThanOrEqual(2);
  });

  it('setupPostProcessing returns composer and bloomPass', () => {
    const c = makeContainer();
    const scene = new THREE.Scene();
    const cam = createCamera(c);
    const rend = createRenderer(c);
    const { composer, bloomPass } = setupPostProcessing(rend, scene, cam, c);
    expect(composer.passes.length).toBeGreaterThan(1);
    expect(bloomPass).toHaveProperty('strength');
  });

  it('createSphere returns mesh and material', () => {
    const { sphere, material } = createSphere(false);
    expect(sphere).toBeInstanceOf(THREE.Mesh);
    expect(material).toBeInstanceOf(THREE.MeshPhysicalMaterial);
  });

  it('createStars returns Points with position attribute', () => {
    const pts = createStars(false);
    expect(pts).toBeInstanceOf(THREE.Points);
    const attr = pts.geometry.getAttribute('position');
    expect(attr.count).toBeGreaterThan(0);
  });

  it('setupLights adds children to scene', () => {
    const scene = new THREE.Scene();
    setupLights(scene);
    expect(scene.children.length).toBeGreaterThanOrEqual(4);
  });

  it('setupGUI inserts lil-gui dom element', () => {
    const dummy = document.createElement('div');
    const fakeMat = new THREE.MeshPhysicalMaterial();
    const fakeBloom = { strength: 1, radius: 0.5, threshold: 0.2 };
    const fakeStars = new THREE.Object3D();
    setupGUI(fakeMat, fakeBloom, fakeStars);
    const guiEl = document.querySelector('.lil-gui');
    expect(guiEl).not.toBeNull();
  });

  it('setupInteractions responds to mouse and wheel', () => {
    const c = makeContainer();
    const cam = createCamera(c);
    const state = setupInteractions(c, cam);
    // simulate mouse movement
    const move = new MouseEvent('mousemove', { clientX: 10, clientY: 10 });
    window.dispatchEvent(move);
    expect(state.mouseX).not.toBe(0);
    // wheel
    const w = new WheelEvent('wheel', { deltaY: 100 });
    window.dispatchEvent(w);
    expect(state.targetZ).not.toBe(cam.position.z);
  });

  it('handleResize adjusts sizes', () => {
    const c = makeContainer(300, 150);
    const cam = createCamera(c);
    const rend = createRenderer(c);
    const dummyComposer = { setSize: vi.fn() };
    handleResize(c, cam, rend, dummyComposer);
    expect(dummyComposer.setSize).toHaveBeenCalledWith(300, 150);
  });

  it('animateLoop runs without throwing and calls composer.render', () => {
    const scene = new THREE.Scene();
    const c = makeContainer();
    const cam = createCamera(c);
    const rend = createRenderer(c);
    const { composer } = setupPostProcessing(rend, scene, cam, c);
    const { sphere } = createSphere(false);
    const stars = createStars(false);
    scene.add(sphere, stars);
    const state = { targetCam: new THREE.Vector3(), mouseX: 0, mouseY: 0, targetZ: cam.position.z };
    const spy = vi.spyOn(composer, 'render');
    // use fake timers so we can advance the RAF loop
    vi.useFakeTimers();
    try {
      animateLoop(scene, cam, composer, sphere, stars, state);
      vi.advanceTimersByTime(50);
      expect(spy).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

});
