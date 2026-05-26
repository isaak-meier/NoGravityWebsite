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

import * as THREE from 'three';
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

    it('beginFollowComet attaches comet orbit', () => {
      const c = makeContainer();
      const cam = new THREE.PerspectiveCamera(45, 1, 0.1, 2000);
      const ctrl = new CameraController(c, cam);
      const fakeComet = {
        getHeadWorldPosition: (v) => v.set(0, 0, 0),
        getFollowOrbitRadius: () => 0.05,
      };
      ctrl.beginFollowComet(fakeComet);
      expect(ctrl.followComet).toBe(fakeComet);
    });

    it('lockToPlanetWithoutIntro skips intro orbit and snaps to follow distance', () => {
      const c = makeContainer();
      const cam = new THREE.PerspectiveCamera(45, 1, 0.1, 2000);
      cam.position.set(0, 5, 25);
      const ctrl = new CameraController(c, cam);
      const mesh = new THREE.Mesh();
      mesh.position.set(100, 0, 0);
      const planet = { mesh, def: { radius: 0.6 } };
      ctrl.lockToPlanetWithoutIntro(planet);
      expect(ctrl.followPlanet).toBe(planet);
      expect(ctrl._introOrbitActive).toBe(false);
      expect(ctrl.zoomActive).toBe(false);
      const center = new THREE.Vector3();
      mesh.getWorldPosition(center);
      expect(cam.position.distanceTo(center)).toBeCloseTo(15, 0);
    });

    it('animateEnterPlanet eases camera inside and keeps planet follow', () => {
      const c = makeContainer();
      const cam = new THREE.PerspectiveCamera(45, 1, 0.1, 2000);
      cam.position.set(0, 40, 0);
      const ctrl = new CameraController(c, cam);
      const mesh = new THREE.Mesh();
      const planet = { mesh, def: { radius: 10 } };
      ctrl.followPlanet = planet;
      ctrl.animateEnterPlanet(planet);
      expect(ctrl._enterPlanetTween).not.toBeNull();
      for (let i = 0; i < 30; i++) {
        ctrl.update(0.2);
      }
      expect(ctrl._enterPlanetTween).toBeNull();
      expect(ctrl.followPlanet).toBe(planet);
      expect(cam.position.distanceTo(new THREE.Vector3(0, 0, 0))).toBeLessThan(10);
    });

    it('animateExitPlanet restores pre-enter camera pose relative to planet', () => {
      const c = makeContainer();
      const cam = new THREE.PerspectiveCamera(45, 1, 0.1, 2000);
      cam.position.set(0, 40, 0);
      cam.lookAt(0, 0, 0);
      const ctrl = new CameraController(c, cam);
      const mesh = new THREE.Mesh();
      const planet = { mesh, def: { radius: 10 } };
      ctrl.followPlanet = planet;
      const beforePos = cam.position.clone();
      const beforeQuat = cam.quaternion.clone();
      ctrl.animateEnterPlanet(planet);
      for (let i = 0; i < 50; i++) {
        ctrl.update(0.2);
      }
      expect(cam.position.distanceTo(beforePos)).toBeGreaterThan(1);
      ctrl.animateExitPlanet(planet);
      expect(cam.position.distanceTo(beforePos)).toBeLessThan(1e-3);
      expect(Math.abs(cam.quaternion.dot(beforeQuat))).toBeCloseTo(1, 4);
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

    it('starts orbit drag when primary mousedown begins on a child canvas (WebGL target)', () => {
      const c = makeContainer(800, 600);
      c.getBoundingClientRect = () => ({ left: 0, top: 0, width: 800, height: 600 });
      const cam = new THREE.PerspectiveCamera(45, 800 / 600, 0.1, 2000);
      const ctrl = new CameraController(c, cam);
      ctrl.followPlanet = { mesh: new THREE.Mesh(), def: { radius: 1 } };
      const canvas = document.createElement('canvas');
      c.appendChild(canvas);
      canvas.dispatchEvent(
        new MouseEvent('mousedown', { button: 0, bubbles: true, clientX: 120, clientY: 140 }),
      );
      expect(ctrl._mouseOrbitDragging).toBe(true);
      expect(ctrl._mouseOrbitDownClient.x).toBe(120);
      expect(ctrl._mouseOrbitDownClient.y).toBe(140);
    });

    it('does not use mousemove for look when mobile (avoids emulated-pointer drift)', () => {
      const c = makeContainer();
      c.getBoundingClientRect = () => ({ left: 0, top: 0, width: 800, height: 600 });
      const cam = new THREE.PerspectiveCamera(45, 1, 0.1, 2000);
      const ctrl = new CameraController(c, cam, { isMobile: true });
      c.dispatchEvent(new MouseEvent('mousemove', { clientX: 600, clientY: 300 }));
      expect(ctrl.mouseX).toBe(0);
      expect(ctrl.mouseY).toBe(0);
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

    it('clears comet follow on Escape and re-locks to fallback planet', () => {
      const c = makeContainer();
      const cam = new THREE.PerspectiveCamera(45, 1, 0.1, 2000);
      const ctrl = new CameraController(c, cam);
      const fallback = { mesh: new THREE.Mesh(), def: { radius: 1 } };
      ctrl._fallbackFollowPlanet = fallback;
      ctrl.followComet = { getHeadWorldPosition: () => {}, getFollowOrbitRadius: () => 0.05 };
      const before = ctrl.mouseLookEnabled;
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      expect(ctrl.followComet).toBeNull();
      expect(ctrl.followPlanet).toBe(fallback);
      expect(ctrl.mouseLookEnabled).toBe(before);
    });

    it('toggles mouse look on Escape when not following comet', () => {
      const c = makeContainer();
      const cam = new THREE.PerspectiveCamera(45, 1, 0.1, 2000);
      const ctrl = new CameraController(c, cam);
      const before = ctrl.mouseLookEnabled;
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      expect(ctrl.mouseLookEnabled).toBe(!before);
    });

    it('wheel uses orbit zoom after fallback re-lock (no free dolly)', () => {
      const c = makeContainer();
      const cam = new THREE.PerspectiveCamera(45, 1, 0.1, 2000);
      cam.position.set(0, 0, 50);
      const ctrl = new CameraController(c, cam);
      const fallback = { mesh: new THREE.Mesh(), def: { radius: 1 } };
      ctrl._fallbackFollowPlanet = fallback;
      ctrl.update(0.016);
      expect(ctrl.followPlanet).toBe(fallback);
      const scaleBefore = ctrl._followDistanceScale;
      window.dispatchEvent(new WheelEvent('wheel', { deltaY: 100 }));
      expect(ctrl._followDistanceScale).not.toBe(scaleBefore);
    });

    it('adjusts follow orbit zoom scale on wheel when locked to planet', () => {
      const c = makeContainer();
      const cam = new THREE.PerspectiveCamera(45, 1, 0.1, 2000);
      const ctrl = new CameraController(c, cam);
      ctrl.followPlanet = { mesh: new THREE.Mesh(), def: { radius: 1 } };
      expect(ctrl._followDistanceScale).toBe(1);
      window.dispatchEvent(new WheelEvent('wheel', { deltaY: 100 }));
      expect(ctrl._followDistanceScale).toBeGreaterThan(1);
    });

    it('adjusts follow orbit zoom scale on wheel when following comet', () => {
      const c = makeContainer();
      const cam = new THREE.PerspectiveCamera(45, 1, 0.1, 2000);
      const ctrl = new CameraController(c, cam);
      ctrl.followComet = { getHeadWorldPosition: () => {}, getFollowOrbitRadius: () => 0.05 };
      expect(ctrl._followDistanceScale).toBe(1);
      window.dispatchEvent(new WheelEvent('wheel', { deltaY: 100 }));
      expect(ctrl._followDistanceScale).toBeGreaterThan(1);
    });
  });

  describe('touch orbit (mobile)', () => {
    it('maps one full horizontal swipe to configured yaw per full drag (linear)', () => {
      const c = makeContainer(800, 600);
      const cam = new THREE.PerspectiveCamera(45, 1, 0.1, 2000);
      const ctrl = new CameraController(c, cam, { isMobile: true });
      ctrl.followPlanet = null;
      const degPerFullSwipe = 18;
      const fullTurn = (2 * Math.PI * degPerFullSwipe) / 360;
      ctrl._applyTouchOrbit(800, 0, c);
      expect(cam.rotation.y).toBeCloseTo(-fullTurn, 5);
    });

    it('accumulates follow yaw by one full swipe', () => {
      const c = makeContainer(800, 600);
      const cam = new THREE.PerspectiveCamera(45, 1, 0.1, 2000);
      const ctrl = new CameraController(c, cam, { isMobile: true });
      ctrl.followPlanet = { mesh: new THREE.Mesh(), def: { radius: 1 } };
      for (let i = 0; i < 40; i++) ctrl.update(0.05);
      const degPerFullSwipe = 90;
      const fullTurn = (2 * Math.PI * degPerFullSwipe) / 360;
      ctrl._applyTouchOrbit(800, 0, c);
      expect(ctrl._followOrbitYaw).toBeCloseTo(-fullTurn, 1);
    });

    it('accumulates follow pitch on vertical swipe when following planet', () => {
      const c = makeContainer(800, 600);
      const cam = new THREE.PerspectiveCamera(45, 1, 0.1, 2000);
      const ctrl = new CameraController(c, cam, { isMobile: true });
      ctrl.followPlanet = { mesh: new THREE.Mesh(), def: { radius: 1 } };
      const before = ctrl._followOrbitPitch;
      ctrl._applyTouchOrbit(0, 600, c);
      expect(ctrl._followOrbitPitch).toBeLessThan(before);
    });
  });

  describe('update', () => {
    it('clears stale mouse look inputs when leaving follow mode', () => {
      const c = makeContainer();
      const cam = new THREE.PerspectiveCamera(45, 1, 0.1, 2000);
      const ctrl = new CameraController(c, cam);
      const planet = { mesh: new THREE.Mesh(), def: { radius: 1 } };
      ctrl.followPlanet = planet;
      ctrl.update(0.016);
      ctrl.mouseX = 0.5;
      ctrl.mouseY = -0.3;
      ctrl.followPlanet = null;
      ctrl.update(0.016);
      expect(ctrl.mouseX).toBe(0);
      expect(ctrl.mouseY).toBe(0);
    });

    it('keeps orbit follow when W is held with fallback lock', () => {
      const c = makeContainer();
      const cam = new THREE.PerspectiveCamera(45, 1, 0.1, 2000);
      cam.position.set(0, 0, 50);
      const ctrl = new CameraController(c, cam);
      const fallback = { mesh: new THREE.Mesh(), def: { radius: 1 } };
      ctrl._fallbackFollowPlanet = fallback;
      ctrl.zoomActive = false;
      ctrl.keys.w = true;
      ctrl.update(0.016);
      expect(ctrl.followPlanet).toBe(fallback);
      ctrl.update(0.1);
      expect(ctrl.followPlanet).toBe(fallback);
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

    it('does not disengage planet follow on WASD when orbit-locked', () => {
      const c = makeContainer();
      const cam = new THREE.PerspectiveCamera(45, 1, 0.1, 2000);
      const ctrl = new CameraController(c, cam);
      const planet = { mesh: new THREE.Mesh(), def: { radius: 1 } };
      ctrl.followPlanet = planet;
      ctrl.keys.w = true;
      ctrl.update(0.016);
      expect(ctrl.followPlanet).toBe(planet);
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

    it('keeps sun at small scale when not following', () => {
      const c = makeContainer();
      const cam = new THREE.PerspectiveCamera(45, 1, 0.1, 2000);
      const ctrl = new CameraController(c, cam);
      ctrl.zoomActive = false;
      const sun = new THREE.Mesh(new THREE.SphereGeometry(3), new THREE.MeshBasicMaterial());
      sun.scale.setScalar(0.04);
      ctrl.sun = sun;
      ctrl.followPlanet = null;
      ctrl.update(0.016);
      expect(sun.scale.x).toBe(0.04);
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
    it('registers click and touch listeners on renderer domElement', () => {
      const c = makeContainer();
      const cam = new THREE.PerspectiveCamera(45, 1, 0.1, 2000);
      const ctrl = new CameraController(c, cam);
      const rend = new THREE.WebGLRenderer();
      const ss = new SolarSystem(true);
      const spy = vi.spyOn(rend.domElement, 'addEventListener');
      ctrl.setupFollowHandler(rend, ss.planets);
      expect(spy).toHaveBeenCalledWith('click', expect.any(Function));
      expect(spy).toHaveBeenCalledWith('touchstart', expect.any(Function), { passive: true });
      expect(spy).toHaveBeenCalledWith('touchmove', expect.any(Function), { passive: true });
      expect(spy).toHaveBeenCalledWith('touchend', expect.any(Function), { passive: true });
    });

    it('stores first planet as fallback follow target', () => {
      const c = makeContainer();
      const cam = new THREE.PerspectiveCamera(45, 1, 0.1, 2000);
      const ctrl = new CameraController(c, cam);
      const rend = new THREE.WebGLRenderer();
      const ss = new SolarSystem(true);
      ctrl.setupFollowHandler(rend, ss.planets);
      expect(ctrl._fallbackFollowPlanet).toBe(ss.planets[0]);
    });
  });

  describe('planet-graph view', () => {
    it('starts with _graphMode = false', () => {
      const c = makeContainer();
      const cam = new THREE.PerspectiveCamera(45, 1, 0.1, 30000);
      const ctrl = new CameraController(c, cam);
      expect(ctrl._graphMode).toBe(false);
    });

    it('flips into graph mode when wheel zoom carries follow distance past the threshold', () => {
      const c = makeContainer();
      const cam = new THREE.PerspectiveCamera(45, 1, 0.1, 30000);
      const ctrl = new CameraController(c, cam);
      ctrl.followPlanet = { mesh: new THREE.Mesh(), def: { radius: 1 } };
      // Pre-bias scale so a single wheel tick crosses the 5000 threshold.
      ctrl._followDistanceScale = 1000;
      window.dispatchEvent(new WheelEvent('wheel', { deltaY: 800 }));
      expect(ctrl._graphMode).toBe(true);
      expect(ctrl.followPlanet).toBeNull();
    });

    it('graph-mode mouse drag yaws more per pixel than follow-mode drag', () => {
      const c = makeContainer(800, 600);
      const cam = new THREE.PerspectiveCamera(45, 800 / 600, 0.1, 30000);
      const ctrlFollow = new CameraController(c, cam);
      ctrlFollow.isMobile = false;
      ctrlFollow.followPlanet = { mesh: new THREE.Mesh(), def: { radius: 1 } };
      ctrlFollow._mouseOrbitDragging = true;
      ctrlFollow._mouseOrbitStart = { x: 0, y: 0 };
      ctrlFollow._mouseOrbitDownClient = { x: 0, y: 0 };
      const beforeYawFollow = ctrlFollow._followOrbitYaw;
      c.dispatchEvent(new MouseEvent('mousemove', { clientX: 200, clientY: 0, bubbles: true }));
      const yawDeltaFollow = Math.abs(ctrlFollow._followOrbitYaw - beforeYawFollow);

      const c2 = makeContainer(800, 600);
      const cam2 = new THREE.PerspectiveCamera(45, 800 / 600, 0.1, 30000);
      const ctrlGraph = new CameraController(c2, cam2);
      ctrlGraph.isMobile = false;
      ctrlGraph._graphMode = true;
      ctrlGraph._mouseOrbitDragging = true;
      ctrlGraph._mouseOrbitStart = { x: 0, y: 0 };
      ctrlGraph._mouseOrbitDownClient = { x: 0, y: 0 };
      const beforeYawGraph = ctrlGraph._graphOrbitYaw;
      c2.dispatchEvent(new MouseEvent('mousemove', { clientX: 200, clientY: 0, bubbles: true }));
      const yawDeltaGraph = Math.abs(ctrlGraph._graphOrbitYaw - beforeYawGraph);

      expect(yawDeltaFollow).toBeGreaterThan(0);
      expect(yawDeltaGraph).toBeGreaterThan(yawDeltaFollow * 2);
    });

    it('seeds graph orbit distance from the camera-to-zoomed-out-planet distance on entry', () => {
      const c = makeContainer();
      const cam = new THREE.PerspectiveCamera(45, 1, 0.1, 30000);
      cam.position.set(0, 0, 17000);
      const ctrl = new CameraController(c, cam);
      ctrl.followPlanet = { mesh: new THREE.Mesh(), def: { radius: 1 } };
      ctrl._enterGraphMode();
      expect(ctrl._lastFollowedPlanetForGraph).toBe(ctrl._lastFollowedPlanetForGraph);
      expect(ctrl._graphOrbitDistance).toBeGreaterThanOrEqual(5000);
      expect(ctrl._graphOrbitDistance).toBeLessThanOrEqual(120000);
    });

    it('wheel-in past hysteresis exits graph mode and re-locks to last followed planet', () => {
      const c = makeContainer();
      const cam = new THREE.PerspectiveCamera(45, 1, 0.1, 30000);
      cam.position.set(0, 0, 17000);
      const ctrl = new CameraController(c, cam);
      const planet = { mesh: new THREE.Mesh(), def: { radius: 1 } };
      ctrl._fallbackFollowPlanet = planet;
      ctrl.followPlanet = planet;
      ctrl._enterGraphMode();
      expect(ctrl._graphMode).toBe(true);
      // Big inward wheel ticks until below 0.9 * 5000 = 4500.
      for (let i = 0; i < 20; i++) {
        window.dispatchEvent(new WheelEvent('wheel', { deltaY: -2000 }));
      }
      expect(ctrl._graphMode).toBe(false);
      expect(ctrl.followPlanet).toBe(planet);
    });

    it('_ensureFollowLocked does not re-lock to fallback while in graph mode', () => {
      const c = makeContainer();
      const cam = new THREE.PerspectiveCamera(45, 1, 0.1, 30000);
      const ctrl = new CameraController(c, cam);
      ctrl._fallbackFollowPlanet = { mesh: new THREE.Mesh(), def: { radius: 1 } };
      ctrl._graphMode = true;
      ctrl.followPlanet = null;
      ctrl._ensureFollowLocked();
      expect(ctrl.followPlanet).toBeNull();
    });

    it('switchToGalaxyView then lockToPlanetWithoutIntro leaves graph mode and follows the pick', () => {
      const c = makeContainer();
      const cam = new THREE.PerspectiveCamera(45, 1, 0.1, 30000);
      const ctrl = new CameraController(c, cam);
      const blue = { mesh: new THREE.Mesh(), def: { radius: 0.9 } };
      const red = { mesh: new THREE.Mesh(), def: { radius: 0.6 } };
      red.mesh.position.set(100, 0, 0);
      ctrl.followPlanet = blue;
      ctrl.switchToGalaxyView();
      expect(ctrl.getViewMode()).toBe('galaxy');
      ctrl.lockToPlanetWithoutIntro(red);
      expect(ctrl._graphMode).toBe(false);
      expect(ctrl.getViewMode()).toBe('planet');
      expect(ctrl.followPlanet).toBe(red);
      expect(ctrl._lastFollowedPlanetForGraph).toBeNull();
    });

    it('_updateGraphView orbits the planet we zoomed out from at _graphOrbitDistance', () => {
      const c = makeContainer();
      const cam = new THREE.PerspectiveCamera(45, 1, 0.1, 30000);
      cam.position.set(0, 0, 17000);
      const ctrl = new CameraController(c, cam);
      const planetMesh = new THREE.Mesh();
      planetMesh.position.set(3500, 800, -1200);
      const planet = { mesh: planetMesh, def: { radius: 1, position: [3500, 800, -1200] } };
      const scene = new THREE.Scene();
      scene.add(planetMesh);
      scene.updateMatrixWorld(true);
      // Simulate "we just zoomed out from this planet" — graph mode should orbit it, not the centroid.
      ctrl._lastFollowedPlanetForGraph = planet;
      ctrl.graphCentroid = new THREE.Vector3(0, 0, 0);
      ctrl._graphMode = true;
      ctrl._graphOrbitDistance = 17000;
      ctrl._graphOrbitYaw = 0;
      ctrl._graphOrbitPitch = Math.PI / 2;
      for (let i = 0; i < 200; i++) ctrl.update(0.05);
      const planetWorld = new THREE.Vector3();
      planetMesh.getWorldPosition(planetWorld);
      expect(cam.position.distanceTo(planetWorld)).toBeGreaterThan(16000);
      expect(cam.position.distanceTo(planetWorld)).toBeLessThan(18000);
      // And critically NOT centered on the centroid (origin) — distance to origin would differ
      // from distance to the planet by ~|planet position| ≈ 3786 if it were centered on origin.
      const distToOrigin = cam.position.length();
      expect(Math.abs(distToOrigin - 17000)).toBeGreaterThan(500);
    });

    it('clicking a non-followed cluster pick proxy in normal mode tweens to that planet', () => {
      const c = makeContainer(800, 600);
      const cam = new THREE.PerspectiveCamera(45, 800 / 600, 0.1, 30000);
      cam.position.set(10000, 0, -3300);
      cam.lookAt(0, 0, -3300);
      cam.updateMatrixWorld(true);
      const ctrl = new CameraController(c, cam);
      const rend = new THREE.WebGLRenderer();
      rend.domElement.getBoundingClientRect = () => ({
        left: 0, top: 0, width: 800, height: 600, x: 0, y: 0, right: 800, bottom: 600,
      });
      const scene = new THREE.Scene();
      const blue = { mesh: new THREE.Mesh(new THREE.SphereGeometry(0.9)), def: { radius: 0.9 } };
      const redMesh = new THREE.Mesh(new THREE.SphereGeometry(0.6));
      redMesh.position.set(0, 0, -3000);
      const red = { mesh: redMesh, def: { radius: 0.6 } };
      scene.add(blue.mesh, redMesh);
      const redProxy = new THREE.Mesh(new THREE.SphereGeometry(800, 16, 12));
      redProxy.position.copy(redMesh.position);
      redProxy.userData.planet = red;
      scene.add(redProxy);
      scene.updateMatrixWorld(true);
      ctrl.graphPickProxies = [redProxy];
      ctrl.setupFollowHandler(rend, [blue, red]);
      ctrl.followPlanet = blue;
      rend.domElement.dispatchEvent(new MouseEvent('click', { clientX: 400, clientY: 300, bubbles: true }));
      expect(ctrl._enterPlanetTween).not.toBeNull();
      expect(ctrl._enterPlanetTween.kind).toBe('graphZoom');
      expect(ctrl._enterPlanetTween.planet).toBe(red);
    });

    it('clicking the currently-followed planet\'s cluster proxy does NOT start a tween', () => {
      const c = makeContainer(800, 600);
      const cam = new THREE.PerspectiveCamera(45, 800 / 600, 0.1, 30000);
      cam.position.set(10000, 0, 0);
      cam.lookAt(0, 300, 0);
      cam.updateMatrixWorld(true);
      const ctrl = new CameraController(c, cam);
      const rend = new THREE.WebGLRenderer();
      rend.domElement.getBoundingClientRect = () => ({
        left: 0, top: 0, width: 800, height: 600, x: 0, y: 0, right: 800, bottom: 600,
      });
      const scene = new THREE.Scene();
      const blue = { mesh: new THREE.Mesh(new THREE.SphereGeometry(0.9)), def: { radius: 0.9 } };
      scene.add(blue.mesh);
      const blueProxy = new THREE.Mesh(new THREE.SphereGeometry(800, 16, 12));
      blueProxy.position.set(0, 0, 0);
      blueProxy.userData.planet = blue;
      scene.add(blueProxy);
      scene.updateMatrixWorld(true);
      ctrl.graphPickProxies = [blueProxy];
      ctrl.setupFollowHandler(rend, [blue]);
      ctrl.followPlanet = blue;
      rend.domElement.dispatchEvent(new MouseEvent('click', { clientX: 400, clientY: 300, bubbles: true }));
      expect(ctrl._enterPlanetTween).toBeNull();
      expect(ctrl.followPlanet).toBe(blue);
    });

    it('_beginGraphZoomToPlanet starts a graphZoom tween that hands off to follow on completion', () => {
      const c = makeContainer();
      const cam = new THREE.PerspectiveCamera(45, 1, 0.1, 30000);
      cam.position.set(0, 0, 17000);
      const ctrl = new CameraController(c, cam);
      const mesh = new THREE.Mesh();
      mesh.position.set(0, 0, 0);
      const planet = { mesh, def: { radius: 1 } };
      ctrl._graphMode = true;
      ctrl._beginGraphZoomToPlanet(planet);
      expect(ctrl._graphMode).toBe(false);
      expect(ctrl._enterPlanetTween).not.toBeNull();
      expect(ctrl._enterPlanetTween.kind).toBe('graphZoom');
      // Run the full duration; on completion the tween clears and followPlanet is set.
      for (let i = 0; i < 200; i++) ctrl.update(0.05);
      expect(ctrl._enterPlanetTween).toBeNull();
      expect(ctrl.followPlanet).toBe(planet);
      expect(ctrl._enterPlanetInteriorHold).toBe(false);
    });

    it('graph orbit can swing past the bottom pole (no clamp, no flip)', () => {
      const c = makeContainer();
      const cam = new THREE.PerspectiveCamera(45, 1, 0.1, 30000);
      cam.position.set(0, 0, 17000);
      const ctrl = new CameraController(c, cam);
      ctrl._lastFollowedPlanetForGraph = null;
      ctrl.graphCentroid = new THREE.Vector3(0, 0, 0);
      ctrl._graphMode = true;
      ctrl._graphOrbitDistance = 17000;
      ctrl._graphOrbitYaw = 0;
      // Pitch beyond the old clamp ceiling (π - 0.12 ≈ 3.02): aim past the bottom pole at 1.25π
      // (camera should land on the "back-bottom" diagonal — y < 0, z < 0).
      ctrl._graphOrbitPitch = Math.PI * 1.25;
      ctrl._syncOrbitDirFromAngles(true);
      for (let i = 0; i < 400; i++) ctrl.update(0.05);
      // Position on the great circle: y = r*cos(1.25π) ≈ -0.707r, z = r*sin(1.25π)*cos(0) ≈ -0.707r.
      expect(cam.position.y).toBeLessThan(-1000);
      expect(cam.position.z).toBeLessThan(-1000);
      // Roll stabilization eases toward world-up look-at when inverted, so local +Y stays readable.
      const camUp = new THREE.Vector3(0, 1, 0).applyQuaternion(cam.quaternion);
      expect(camUp.y).toBeGreaterThan(0.08);
      // Look direction still points at the orbit center (unit vector toward origin).
      const camForward = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
      const toCenter = cam.position.clone().negate().normalize();
      expect(camForward.dot(toCenter)).toBeGreaterThan(0.99);
    });

    it('Key R resets follow orbit yaw/pitch to a neutral pose', () => {
      const c = makeContainer();
      const cam = new THREE.PerspectiveCamera(45, 1, 0.1, 30000);
      const ctrl = new CameraController(c, cam);
      ctrl.isMobile = false;
      ctrl.followPlanet = { mesh: new THREE.Mesh(), def: { radius: 1 } };
      ctrl._followOrbitYaw = 2.5;
      ctrl._followOrbitPitch = 0.2;
      window.dispatchEvent(
        new KeyboardEvent('keydown', { code: 'KeyR', key: 'r', bubbles: true, cancelable: true })
      );
      expect(ctrl._followOrbitYaw).toBe(0);
      expect(ctrl._followOrbitPitch).toBe(ctrl._defaultFollowPitch());
    });

    it('graphZoom tween slerps orientation instead of snapping to the picked planet', () => {
      const c = makeContainer();
      const cam = new THREE.PerspectiveCamera(45, 1, 0.1, 30000);
      cam.position.set(0, 0, 1000);
      cam.lookAt(0, 0, 0);
      cam.updateMatrixWorld(true);
      const startQuat = cam.quaternion.clone();
      const ctrl = new CameraController(c, cam);
      const mesh = new THREE.Mesh();
      mesh.position.set(2000, 0, 0);
      const planet = { mesh, def: { radius: 1 } };
      ctrl._beginGraphZoomToPlanet(planet);
      expect(ctrl._enterPlanetTween.startQuat).toBeDefined();
      expect(ctrl._enterPlanetTween.endQuat).toBeDefined();
      expect(cam.quaternion.angleTo(startQuat)).toBeLessThan(1e-6);
      ctrl._enterPlanetTween.elapsed = ctrl._enterPlanetTween.duration * 0.02;
      ctrl._updateEnterPlanetAnimation(0);
      const angleAfterTinyStep = cam.quaternion.angleTo(startQuat);
      expect(angleAfterTinyStep).toBeLessThan(0.3);
    });

    it('does not re-lock follow when shardFlightMode is true and followPlanet is null', () => {
      const c = makeContainer();
      const cam = new THREE.PerspectiveCamera(45, 1, 0.1, 30000);
      const ctrl = new CameraController(c, cam);
      const fake = { mesh: new THREE.Mesh(), def: { radius: 1 } };
      ctrl._fallbackFollowPlanet = fake;
      ctrl.followPlanet = null;
      ctrl.shardFlightMode = true;
      ctrl.update(0.016);
      expect(ctrl.followPlanet).toBeNull();
    });
  });
});
