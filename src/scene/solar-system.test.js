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
import SolarSystem, { PLANET_DEFS } from './solar-system.js';

describe('SolarSystem', () => {
  beforeAll(() => {
    if (typeof window.matchMedia !== 'function') {
      window.matchMedia = () => ({ matches: false, addListener: () => {}, removeListener: () => {} });
    }
  });
  beforeEach(() => { document.body.innerHTML = ''; });

  describe('constructor', () => {
    it('creates a sun mesh', () => {
      const ss = new SolarSystem(false);
      expect(ss.sun).toBeInstanceOf(THREE.Mesh);
    });

    it('creates 5 planets matching PLANET_DEFS', () => {
      const ss = new SolarSystem(false);
      expect(ss.planets).toHaveLength(PLANET_DEFS.length);
    });

    it('creates a starField Points object', () => {
      const ss = new SolarSystem(false);
      expect(ss.starField).toBeInstanceOf(THREE.Points);
    });

    it('sun has yellow MeshBasicMaterial', () => {
      const ss = new SolarSystem(false);
      expect(ss.sun.material.color.getHex()).toBe(0xffcc33);
    });

    it('desktop sun uses 48 segments', () => {
      const ss = new SolarSystem(false);
      expect(ss.sun.geometry.parameters.widthSegments).toBe(48);
    });

    it('mobile sun uses 24 segments', () => {
      const ss = new SolarSystem(true);
      expect(ss.sun.geometry.parameters.widthSegments).toBe(24);
    });

    it('each planet has mesh, material, pivot, def, and interior goop', () => {
      const ss = new SolarSystem(false);
      for (const p of ss.planets) {
        expect(p.mesh).toBeInstanceOf(THREE.Mesh);
        expect(p.material).toBeInstanceOf(THREE.MeshPhysicalMaterial);
        expect(p.pivot).toBeInstanceOf(THREE.Group);
        expect(p.def).toHaveProperty('orbit');
        expect(p.goopMaterial).toBeDefined();
        expect(p.goopMaterial.uniforms.uTime).toBeDefined();
        const inner = p.mesh.children.find((c) => c.name === 'planetInteriorGoop');
        expect(inner).toBeDefined();
      }
    });

    it('desktop planets use 64 segments', () => {
      const ss = new SolarSystem(false);
      expect(ss.planets[0].mesh.geometry.parameters.widthSegments).toBe(64);
    });

    it('mobile planets use 32 segments', () => {
      const ss = new SolarSystem(true);
      expect(ss.planets[0].mesh.geometry.parameters.widthSegments).toBe(32);
    });

    it('desktop uses 3000 stars', () => {
      const ss = new SolarSystem(false);
      expect(ss.starField.geometry.getAttribute('position').count).toBe(3000);
    });

    it('mobile uses 1200 stars', () => {
      const ss = new SolarSystem(true);
      expect(ss.starField.geometry.getAttribute('position').count).toBe(1200);
    });

    it('all star positions are at distance >= 200', () => {
      const ss = new SolarSystem(false);
      const positions = ss.starField.geometry.getAttribute('position');
      for (let i = 0; i < positions.count; i++) {
        const x = positions.getX(i);
        const y = positions.getY(i);
        const z = positions.getZ(i);
        expect(Math.sqrt(x * x + y * y + z * z)).toBeGreaterThanOrEqual(199);
      }
    });
  });

  describe('primary', () => {
    it('returns the first planet (Blue)', () => {
      const ss = new SolarSystem(false);
      expect(ss.primary).toBe(ss.planets[0]);
      expect(ss.primary.def.label).toBe('Blue');
    });
  });

  describe('addToScene', () => {
    it('adds sun, planet pivots, stars, and lights to scene', () => {
      const ss = new SolarSystem(false);
      const scene = new THREE.Scene();
      ss.addToScene(scene);
      // sun + 5 pivots + stars + 3 lights = 10
      expect(scene.children.length).toBeGreaterThanOrEqual(10);
    });

    it('sets sunLight on the instance', () => {
      const ss = new SolarSystem(false);
      const scene = new THREE.Scene();
      expect(ss.sunLight).toBeNull();
      ss.addToScene(scene);
      expect(ss.sunLight).toBeInstanceOf(THREE.PointLight);
    });

    it('adds a PointLight, AmbientLight, and HemisphereLight', () => {
      const ss = new SolarSystem(false);
      const scene = new THREE.Scene();
      ss.addToScene(scene);
      expect(scene.children.find(c => c instanceof THREE.PointLight)).toBeDefined();
      expect(scene.children.find(c => c instanceof THREE.AmbientLight)).toBeDefined();
      expect(scene.children.find(c => c instanceof THREE.HemisphereLight)).toBeDefined();
    });
  });

  describe('update', () => {
    it('keeps pivot rotation fixed when orbital motion is disabled', () => {
      const ss = new SolarSystem(false);
      const initY = ss.planets[0].pivot.rotation.y;
      ss.update(1);
      expect(ss.planets[0].pivot.rotation.y).toBe(initY);
    });

    it('spins planet meshes', () => {
      const ss = new SolarSystem(false);
      const initY = ss.planets[0].mesh.rotation.y;
      ss.update(1);
      expect(ss.planets[0].mesh.rotation.y).not.toBe(initY);
    });

    it('rotates star field', () => {
      const ss = new SolarSystem(false);
      const initY = ss.starField.rotation.y;
      ss.update(1);
      expect(ss.starField.rotation.y).not.toBe(initY);
    });

    it('advances interior goop time uniform', () => {
      const ss = new SolarSystem(false);
      const dt = 0.5;
      const before = ss.planets[0].goopMaterial.uniforms.uTime.value;
      ss.update(dt);
      expect(ss.planets[0].goopMaterial.uniforms.uTime.value).toBeCloseTo(before + dt);
    });
  });

  describe('PLANET_DEFS', () => {
    it('has 5 planet definitions', () => {
      expect(PLANET_DEFS).toHaveLength(5);
    });

    it('each def has color, radius, orbit, speed, and label', () => {
      for (const def of PLANET_DEFS) {
        expect(def).toHaveProperty('color');
        expect(def).toHaveProperty('radius');
        expect(def).toHaveProperty('orbit');
        expect(def).toHaveProperty('speed');
        expect(def).toHaveProperty('label');
      }
    });

    it('planet orbits are strictly increasing', () => {
      for (let i = 1; i < PLANET_DEFS.length; i++) {
        expect(PLANET_DEFS[i].orbit).toBeGreaterThan(PLANET_DEFS[i - 1].orbit);
      }
    });
  });
});
