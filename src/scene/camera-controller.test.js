/** @vitest-environment jsdom */

import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';

vi.mock('/node_modules/three/build/three.module.js', async (importOriginal) => {
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
  const sRGBEncoding = Object.prototype.hasOwnProperty.call(actual, 'sRGBEncoding')
    ? actual.sRGBEncoding : 3000;
  const ACESFilmicToneMapping = Object.prototype.hasOwnProperty.call(actual, 'ACESFilmicToneMapping')
    ? actual.ACESFilmicToneMapping : 3001;
  return { ...actual, WebGLRenderer: FakeRenderer, sRGBEncoding, ACESFilmicToneMapping };
});

import * as THREE from '/node_modules/three/build/three.module.js';
import CameraController from './camera-controller.js';
import SolarSystem from './solar-system.js';

function makeContainer(w = 800, h = 600) {
  const c = document.createElement('div');
  Object.defineProperty(c, 'clientWidth', { value: w, configurable: true });
  Object.defineProperty(c, 'clientHeight', { value: h, configurable: true });
  document.body.appendChild(c);
  return c;
}

describe('CameraController', () => {
  beforeAll(() => {
    if (typeof window.matchMedia !== 'function') {
      window.matchMedia = () => ({ matches: false, addListener: () => {}, removeListener: () => {} });
    }
  });
  beforeEach(() => { document.body.innerHTML = ''; });

  describe('constructor', () => {
    it('stores camera reference', () => {
      const c = makeContainer();
      const cam = new THREE.PerspectiveCamera(45, 1, 0.1, 2000);
      const ctrl = new CameraController(c, cam);
      expect(ctrl.camera).toBe(cam);
    });

    it('initialises mouseX and mouseY to zero', () => {
      const c = makeContainer();
      const cam = new THREE.PerspectiveCamera(45, 1, 0.1, 2000);
      const ctrl = new CameraController(c, cam);
      expect(ctrl.mouseX).toBe(0);
      expect(ctrl.mouseY).toBe(0);
    });

    it('initialises all keys as false', () => {
      const c = makeContainer();
      const cam = new THREE.PerspectiveCamera(45, 1, 0.1, 2000);
      const ctrl = new CameraController(c, cam);
      for (const k of Object.values(ctrl.keys)) {
        expect(k).toBe(false);
      }
    });

    it('sets zoomActive true and default zoomTarget', () => {
      const c = makeContainer();
      const cam = new THREE.PerspectiveCamera(45, 1, 0.1, 2000);
      const ctrl = new CameraController(c, cam);
      expect(ctrl.zoomActive).toBe(true);
      expect(ctrl.zoomTarget).toBeInstanceOf(THREE.Vector3);
    });

    it('sets followPlanet to null', () => {
      const c = makeContainer();
      const cam = new THREE.PerspectiveCamera(45, 1, 0.1, 2000);
      const ctrl = new CameraController(c, cam);
      expect(ctrl.followPlanet).toBeNull();
    });
  });

  describe('input events', () => {
    it('updates mouseX/mouseY on mousemove', () => {
      const c = makeContainer();
      c.getBoundingClientRect = () => ({ left: 0, top: 0, width: 800, height: 600 });
      const cam = new THREE.PerspectiveCamera(45, 1, 0.1, 2000);
      const ctrl = new CameraController(c, cam);
      c.dispatchEvent(new MouseEvent('mousemove', { clientX: 600, clientY: 300 }));
      expect(ctrl.mouseX).not.toBe(0);
    });

    it('tracks WASD keydown/keyup', () => {
      const c = makeContainer();
      const cam = new THREE.PerspectiveCamera(45, 1, 0.1, 2000);
      const ctrl = new CameraController(c, cam);
      expect(ctrl.keys.w).toBe(false);
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'w' }));
      expect(ctrl.keys.w).toBe(true);
      window.dispatchEvent(new KeyboardEvent('keyup', { key: 'w' }));
      expect(ctrl.keys.w).toBe(false);
    });

    it('clears followPlanet on Escape', () => {
      const c = makeContainer();
      const cam = new THREE.PerspectiveCamera(45, 1, 0.1, 2000);
      const ctrl = new CameraController(c, cam);
      ctrl.followPlanet = { mesh: new THREE.Mesh(), def: { radius: 1 } };
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      expect(ctrl.followPlanet).toBeNull();
    });

    it('moves camera on wheel', () => {
      const c = makeContainer();
      const cam = new THREE.PerspectiveCamera(45, 1, 0.1, 2000);
      cam.position.set(0, 0, 50);
      const ctrl = new CameraController(c, cam);
      const initialZ = cam.position.z;
      window.dispatchEvent(new WheelEvent('wheel', { deltaY: 100 }));
      expect(cam.position.z).not.toBe(initialZ);
    });
  });

  describe('update', () => {
    it('moves camera forward when W key is pressed', () => {
      const c = makeContainer();
      const cam = new THREE.PerspectiveCamera(45, 1, 0.1, 2000);
      cam.position.set(0, 0, 50);
      const ctrl = new CameraController(c, cam);
      ctrl.zoomActive = false;
      ctrl.keys.w = true;
      const before = cam.position.z;
      ctrl.update(0.1);
      expect(cam.position.z).not.toBe(before);
    });

    it('does not move camera when no keys pressed and zoom inactive', () => {
      const c = makeContainer();
      const cam = new THREE.PerspectiveCamera(45, 1, 0.1, 2000);
      cam.position.set(0, 0, 50);
      const ctrl = new CameraController(c, cam);
      ctrl.zoomActive = false;
      const before = cam.position.clone();
      ctrl.update(0.1);
      // Position may change slightly from mouse look lerp, but z shouldn't move much
      expect(cam.position.z).toBeCloseTo(before.z, 0);
    });

    it('lerps camera position when zoomActive', () => {
      const c = makeContainer();
      const cam = new THREE.PerspectiveCamera(45, 1, 0.1, 2000);
      cam.position.set(0, 80, 300);
      const ctrl = new CameraController(c, cam);
      ctrl.zoomActive = true;
      ctrl.zoomTarget.set(0, 5, 25);
      const before = cam.position.z;
      ctrl.update(0.016);
      expect(cam.position.z).toBeLessThan(before);
    });

    it('disengages follow if WASD pressed', () => {
      const c = makeContainer();
      const cam = new THREE.PerspectiveCamera(45, 1, 0.1, 2000);
      const ctrl = new CameraController(c, cam);
      ctrl.followPlanet = { mesh: new THREE.Mesh(), def: { radius: 1 } };
      ctrl.keys.w = true;
      ctrl.update(0.016);
      expect(ctrl.followPlanet).toBeNull();
    });

    it('lerps sun scale down when following a planet', () => {
      const c = makeContainer();
      const cam = new THREE.PerspectiveCamera(45, 1, 0.1, 2000);
      const ctrl = new CameraController(c, cam);
      const sun = new THREE.Mesh(new THREE.SphereGeometry(3), new THREE.MeshBasicMaterial());
      ctrl.sun = sun;
      ctrl.followPlanet = { mesh: new THREE.Mesh(), def: { radius: 1 } };
      // Make follow persist (no WASD)
      ctrl.keys.w = false;
      const before = sun.scale.x;
      ctrl.update(0.016);
      expect(sun.scale.x).toBeLessThan(before);
    });

    it('lerps sun scale back up when not following', () => {
      const c = makeContainer();
      const cam = new THREE.PerspectiveCamera(45, 1, 0.1, 2000);
      const ctrl = new CameraController(c, cam);
      ctrl.zoomActive = false;
      const sun = new THREE.Mesh(new THREE.SphereGeometry(3), new THREE.MeshBasicMaterial());
      sun.scale.setScalar(0.04);
      ctrl.sun = sun;
      ctrl.followPlanet = null;
      ctrl.update(0.016);
      expect(sun.scale.x).toBeGreaterThan(0.04);
    });

    it('lerps sunLight intensity when following', () => {
      const c = makeContainer();
      const cam = new THREE.PerspectiveCamera(45, 1, 0.1, 2000);
      const ctrl = new CameraController(c, cam);
      const sunLight = new THREE.PointLight(0xffffff, 3);
      ctrl.sunLight = sunLight;
      ctrl.followPlanet = { mesh: new THREE.Mesh(), def: { radius: 1 } };
      ctrl.keys.w = false;
      ctrl.update(0.016);
      expect(sunLight.intensity).toBeLessThan(3);
    });
  });

  describe('setupFollowHandler', () => {
    it('registers a click listener on renderer domElement', () => {
      const c = makeContainer();
      const cam = new THREE.PerspectiveCamera(45, 1, 0.1, 2000);
      const ctrl = new CameraController(c, cam);
      const rend = new THREE.WebGLRenderer();
      const ss = new SolarSystem(true);
      const spy = vi.spyOn(rend.domElement, 'addEventListener');
      ctrl.setupFollowHandler(rend, ss.planets);
      expect(spy).toHaveBeenCalledWith('click', expect.any(Function));
    });
  });
});
