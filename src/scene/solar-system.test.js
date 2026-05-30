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
import SolarSystem, {
  PLANET_DEFS,
  computeKnnEdges,
  buildInterstitialStarPositions,
  buildGraphEdgeStarPositions,
  INTERSTITIAL_CLEARANCE,
  GRAPH_LASER_FAN_BEAMS,
  GRAPH_EQ_BAR_COUNT,
  spectrumToGraphEqBands,
  countGraphLineVertices,
} from './solar-system.js';

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

    it('creates interstitial filler stars as a second Points layer', () => {
      const ss = new SolarSystem(false);
      expect(ss.interstitialStars).toBeInstanceOf(THREE.Points);
      expect(ss.interstitialStars.geometry.getAttribute('position').count).toBe(4500);
    });

    it('creates graph-edge star Points hugging laser beams', () => {
      const ss = new SolarSystem(false);
      expect(ss.graphEdgeStars).toBeInstanceOf(THREE.Points);
      expect(ss.graphEdgeStars.geometry.getAttribute('position').count).toBe(2800);
    });

    it('mobile uses fewer graph-edge stars', () => {
      const ss = new SolarSystem(true);
      expect(ss.graphEdgeStars.geometry.getAttribute('position').count).toBe(1000);
    });

    it('mobile uses fewer interstitial stars', () => {
      const ss = new SolarSystem(true);
      expect(ss.interstitialStars.geometry.getAttribute('position').count).toBe(1800);
    });

    it('sun has warm translucent MeshBasicMaterial (smooth sphere, not comet-head)', () => {
      const ss = new SolarSystem(false);
      expect(ss.sun.material.color.getHex()).toBe(0xfff9ec);
      expect(ss.sun.material.transparent).toBe(true);
      expect(ss.sun.geometry.parameters.radius).toBe(12);
    });

    it('sun uses a higher-resolution sphere than the comet nucleus (desktop)', () => {
      const ss = new SolarSystem(false);
      expect(ss.sun.geometry.parameters.widthSegments).toBe(40);
      expect(ss.sun.geometry.parameters.heightSegments).toBe(28);
    });

    it('sun uses a higher-resolution sphere than the comet nucleus (mobile)', () => {
      const ss = new SolarSystem(true);
      expect(ss.sun.geometry.parameters.widthSegments).toBe(40);
      expect(ss.sun.geometry.parameters.heightSegments).toBe(28);
    });

    it('each planet has mesh, material, pivot, def, and interior goop', () => {
      const ss = new SolarSystem(false);
      for (const p of ss.planets) {
        expect(p.mesh).toBeInstanceOf(THREE.Mesh);
        expect(p.material).toBeInstanceOf(THREE.MeshPhysicalMaterial);
        expect(p.pivot).toBeInstanceOf(THREE.Group);
        expect(p.def).toHaveProperty('position');
        expect(p.def.position).toHaveLength(3);
        expect(p.goopMaterial).toBeDefined();
        expect(p.goopMaterial.uniforms.uTime).toBeDefined();
        const inner = p.mesh.children.find((c) => c.name === 'planetInteriorGoop');
        expect(inner).toBeDefined();
      }
    });

    it('places each planet mesh at its def.position', () => {
      const ss = new SolarSystem(false);
      for (const p of ss.planets) {
        expect(p.mesh.position.x).toBe(p.def.position[0]);
        expect(p.mesh.position.y).toBe(p.def.position[1]);
        expect(p.mesh.position.z).toBe(p.def.position[2]);
      }
    });

    it('all planet pivots are visible (graph view shows every node)', () => {
      const ss = new SolarSystem(false);
      const scene = new THREE.Scene();
      ss.addToScene(scene);
      for (const p of ss.planets) {
        expect(p.pivot.visible).toBe(true);
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

    it('setPrimaryHubSpinPaused holds the blue hub mesh angle', () => {
      const ss = new SolarSystem(false);
      ss.update(1);
      const frozenY = ss.planets[0].mesh.rotation.y;
      ss.setPrimaryHubSpinPaused(true);
      ss.update(1);
      expect(ss.planets[0].mesh.rotation.y).toBe(frozenY);
      ss.setPrimaryHubSpinPaused(false);
      ss.update(1);
      expect(ss.planets[0].mesh.rotation.y).not.toBe(frozenY);
    });

    it('rotates star field', () => {
      const ss = new SolarSystem(false);
      const initY = ss.starField.rotation.y;
      ss.update(1);
      expect(ss.starField.rotation.y).not.toBe(initY);
    });

    it('rotates interstitial and graph-edge star fields in sync with the main starfield', () => {
      const ss = new SolarSystem(false);
      const initI = ss.interstitialStars.rotation.y;
      const initG = ss.graphEdgeStars.rotation.y;
      ss.update(1);
      expect(ss.interstitialStars.rotation.y).not.toBe(initI);
      expect(ss.graphEdgeStars.rotation.y).not.toBe(initG);
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

    it('each def has color, radius, position, speed, and label', () => {
      for (const def of PLANET_DEFS) {
        expect(def).toHaveProperty('color');
        expect(def).toHaveProperty('radius');
        expect(def).toHaveProperty('position');
        expect(def.position).toHaveLength(3);
        expect(def).toHaveProperty('speed');
        expect(def).toHaveProperty('label');
      }
    });

    it('Blue (primary) planet sits at the origin so close-up systems are unchanged', () => {
      expect(PLANET_DEFS[0].label).toBe('Blue');
      expect(PLANET_DEFS[0].position).toEqual([0, 0, 0]);
    });

    it('non-primary planets are spread across thousands of units in 3D', () => {
      for (let i = 1; i < PLANET_DEFS.length; i++) {
        const [x, y, z] = PLANET_DEFS[i].position;
        const r = Math.sqrt(x * x + y * y + z * z);
        expect(r).toBeGreaterThan(2000);
        expect(r).toBeLessThan(8000);
      }
    });
  });

  describe('planet graph view', () => {
    it('builds one star cluster per planet as THREE.Points', () => {
      const ss = new SolarSystem(false);
      expect(ss.planetClusters).toHaveLength(PLANET_DEFS.length);
      for (const cluster of ss.planetClusters) {
        expect(cluster).toBeInstanceOf(THREE.Points);
      }
    });

    it("each planet's world position matches the centroid of its cluster (planet sits inside its cluster)", () => {
      const ss = new SolarSystem(false);
      const scene = new THREE.Scene();
      ss.addToScene(scene);
      scene.updateMatrixWorld(true);
      const planetWorld = new THREE.Vector3();
      for (let i = 0; i < ss.planets.length; i++) {
        ss.planets[i].mesh.getWorldPosition(planetWorld);
        const positions = ss.planetClusters[i].geometry.getAttribute('position');
        let cx = 0, cy = 0, cz = 0;
        for (let j = 0; j < positions.count; j++) {
          cx += positions.getX(j);
          cy += positions.getY(j);
          cz += positions.getZ(j);
        }
        cx /= positions.count;
        cy /= positions.count;
        cz /= positions.count;
        // Mean of uniformly-sampled shell points lands near the shell center; tolerance covers sampling noise.
        expect(Math.abs(cx - planetWorld.x)).toBeLessThan(150);
        expect(Math.abs(cy - planetWorld.y)).toBeLessThan(150);
        expect(Math.abs(cz - planetWorld.z)).toBeLessThan(150);
      }
    });

    it('cluster vertices sit within the same shell as the original starfield (radius 200..800)', () => {
      const ss = new SolarSystem(false);
      for (let i = 0; i < ss.planets.length; i++) {
        const center = ss.planets[i].def.position;
        const positions = ss.planetClusters[i].geometry.getAttribute('position');
        for (let j = 0; j < positions.count; j++) {
          const dx = positions.getX(j) - center[0];
          const dy = positions.getY(j) - center[1];
          const dz = positions.getZ(j) - center[2];
          const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
          expect(d).toBeGreaterThanOrEqual(199);
          expect(d).toBeLessThanOrEqual(801);
        }
      }
    });

    it('per-planet clusters use the same star count as the original starfield', () => {
      const ssDesktop = new SolarSystem(false);
      const expectedDesktop = ssDesktop.starField.geometry.getAttribute('position').count;
      for (const cluster of ssDesktop.planetClusters) {
        expect(cluster.geometry.getAttribute('position').count).toBe(expectedDesktop);
      }
      const ssMobile = new SolarSystem(true);
      const expectedMobile = ssMobile.starField.geometry.getAttribute('position').count;
      for (const cluster of ssMobile.planetClusters) {
        expect(cluster.geometry.getAttribute('position').count).toBe(expectedMobile);
      }
    });

    it('exposes pick proxies (one per planet, with userData.planet ref) for graph-mode raycasts', () => {
      const ss = new SolarSystem(false);
      const proxies = ss.getClusterPickProxies();
      expect(proxies).toHaveLength(ss.planets.length);
      for (let i = 0; i < proxies.length; i++) {
        expect(proxies[i]).toBeInstanceOf(THREE.Mesh);
        expect(proxies[i].userData.planet).toBe(ss.planets[i]);
        expect(proxies[i].position.x).toBe(ss.planets[i].def.position[0]);
      }
    });

    it('builds graph edge LineSegments with even vertex count', () => {
      const ss = new SolarSystem(false);
      expect(ss.graphLines).toBeInstanceOf(THREE.LineSegments);
      const positions = ss.graphLines.geometry.getAttribute('position');
      expect(positions.count % 2).toBe(0);
      expect(positions.count).toBeGreaterThan(0);
      const scaled = PLANET_DEFS.map((d) => [
        d.position[0],
        d.position[1],
        d.position[2],
      ]);
      expect(positions.count).toBe(
        countGraphLineVertices(computeKnnEdges(scaled, 2), PLANET_DEFS.length, GRAPH_LASER_FAN_BEAMS),
      );
      const lineProgress = ss.graphLines.geometry.getAttribute('lineProgress');
      const edgePhase = ss.graphLines.geometry.getAttribute('edgePhase');
      const barIndex = ss.graphLines.geometry.getAttribute('barIndex');
      const blueFanBeam = ss.graphLines.geometry.getAttribute('blueFanBeam');
      expect(lineProgress.count).toBe(positions.count);
      expect(edgePhase.count).toBe(positions.count);
      expect(barIndex.count).toBe(positions.count);
      expect(blueFanBeam.count).toBe(positions.count);
      expect(ss.graphLines.material.type).toBe('ShaderMaterial');
    });

    it('setGraphLaserEightBarPhase for file with empty hot chunks: 8-bar blink + star opacity', () => {
      const ss = new SolarSystem(false);
      ss.setGraphLaserHotChunkIndices([]);
      const bar = 2;
      const mat = ss.graphLines.material;
      expect(mat.uniforms.uLaserCycle.value).toBe(1);
      ss.setGraphLaserEightBarPhase(0, bar);
      expect(mat.uniforms.uLaserCycle.value).toBe(1);
      expect(ss.graphEdgeStars.material.opacity).toBeCloseTo(0.82, 5);
      ss.setGraphLaserEightBarPhase(7 * bar + bar * 0.99, bar);
      expect(mat.uniforms.uLaserCycle.value).toBe(1);
      ss.setGraphLaserEightBarPhase(8 * bar, bar);
      expect(mat.uniforms.uLaserCycle.value).toBe(0);
      expect(ss.graphEdgeStars.material.opacity).toBe(0);
      ss.setGraphLaserEightBarPhase(16 * bar, bar);
      expect(mat.uniforms.uLaserCycle.value).toBe(1);
      expect(ss.graphEdgeStars.material.opacity).toBeCloseTo(0.82, 5);
      ss.setGraphLaserEightBarPhase(10, NaN);
      expect(mat.uniforms.uLaserCycle.value).toBe(1);
    });

    it('setGraphLaserEightBarPhase live path (null time) uses wall clock when bar is finite', () => {
      const ss = new SolarSystem(false);
      const bar = 2;
      const mat = ss.graphLines.material;
      ss.setGraphLaserEightBarPhase(null, bar);
      expect([0, 1]).toContain(mat.uniforms.uLaserCycle.value);
      expect(ss.graphEdgeStars.material.opacity).toBeCloseTo(0.82 * mat.uniforms.uLaserCycle.value, 5);
    });

    it('setGraphLaserEightBarPhase for file: off until hot chunks set; then only inside 16-bar hot windows', () => {
      const ss = new SolarSystem(false);
      const bar = 2;
      const mat = ss.graphLines.material;
      ss.setGraphLaserEightBarPhase(0, bar);
      expect(mat.uniforms.uLaserCycle.value).toBe(0);
      ss.setGraphLaserHotChunkIndices([0, 2]);
      ss.setGraphLaserEightBarPhase(0, bar);
      expect(mat.uniforms.uLaserCycle.value).toBe(1);
      ss.setGraphLaserEightBarPhase(15 * bar + bar * 0.99, bar);
      expect(mat.uniforms.uLaserCycle.value).toBe(1);
      ss.setGraphLaserEightBarPhase(16 * bar, bar);
      expect(mat.uniforms.uLaserCycle.value).toBe(0);
      ss.setGraphLaserEightBarPhase(32 * bar, bar);
      expect(mat.uniforms.uLaserCycle.value).toBe(1);
      ss.setGraphLaserEightBarPhase(48 * bar, bar);
      expect(mat.uniforms.uLaserCycle.value).toBe(0);
    });

    it('setGraphLaserManualOverride forces lasers on or off regardless of hot chunks', () => {
      const ss = new SolarSystem(false);
      const bar = 2;
      const mat = ss.graphLines.material;
      ss.setGraphLaserHotChunkIndices([0]);
      ss.setGraphLaserEightBarPhase(32 * bar, bar);
      expect(mat.uniforms.uLaserCycle.value).toBe(0);
      ss.setGraphLaserManualOverride('on');
      ss.setGraphLaserEightBarPhase(32 * bar, bar);
      expect(mat.uniforms.uLaserCycle.value).toBe(1);
      ss.setGraphLaserManualOverride('off');
      ss.setGraphLaserEightBarPhase(0, bar);
      expect(mat.uniforms.uLaserCycle.value).toBe(0);
      ss.setGraphLaserManualOverride(null);
      ss.setGraphLaserEightBarPhase(0, bar);
      expect(mat.uniforms.uLaserCycle.value).toBe(1);
    });

    it('addToScene attaches clusters, pick proxies, graph lines, graph-edge stars, and interstitial stars to the scene', () => {
      const ss = new SolarSystem(false);
      const scene = new THREE.Scene();
      ss.addToScene(scene);
      for (const cluster of ss.planetClusters) {
        expect(scene.children).toContain(cluster);
      }
      for (const proxy of ss.getClusterPickProxies()) {
        expect(scene.children).toContain(proxy);
      }
      expect(scene.children).toContain(ss.graphLines);
      expect(scene.children).toContain(ss.interstitialStars);
      expect(scene.children).toContain(ss.graphEdgeStars);
    });

    it('setPlanetSpacing scales mesh, cluster, and pick-proxy world positions', () => {
      const ss = new SolarSystem(false);
      const scene = new THREE.Scene();
      ss.addToScene(scene);
      ss.setPlanetSpacing(2);
      scene.updateMatrixWorld(true);
      const planetWorld = new THREE.Vector3();
      const proxyWorld = new THREE.Vector3();
      for (let i = 0; i < ss.planets.length; i++) {
        const base = PLANET_DEFS[i].position;
        ss.planets[i].mesh.getWorldPosition(planetWorld);
        ss._clusterPickProxies[i].getWorldPosition(proxyWorld);
        expect(planetWorld.x).toBeCloseTo(base[0] * 2, 3);
        expect(planetWorld.y).toBeCloseTo(base[1] * 2, 3);
        expect(planetWorld.z).toBeCloseTo(base[2] * 2, 3);
        expect(proxyWorld.x).toBeCloseTo(base[0] * 2, 3);
        expect(proxyWorld.y).toBeCloseTo(base[1] * 2, 3);
        expect(proxyWorld.z).toBeCloseTo(base[2] * 2, 3);
      }
    });

    it('after setPlanetSpacing, planet stays at the centroid of its cluster', () => {
      const ss = new SolarSystem(false);
      const scene = new THREE.Scene();
      ss.addToScene(scene);
      ss.setPlanetSpacing(2.5);
      scene.updateMatrixWorld(true);
      const planetWorld = new THREE.Vector3();
      for (let i = 0; i < ss.planets.length; i++) {
        ss.planets[i].mesh.getWorldPosition(planetWorld);
        const positions = ss.planetClusters[i].geometry.getAttribute('position');
        const clusterPos = ss.planetClusters[i].position;
        let cx = 0, cy = 0, cz = 0;
        for (let j = 0; j < positions.count; j++) {
          cx += positions.getX(j) + clusterPos.x;
          cy += positions.getY(j) + clusterPos.y;
          cz += positions.getZ(j) + clusterPos.z;
        }
        cx /= positions.count; cy /= positions.count; cz /= positions.count;
        expect(Math.abs(cx - planetWorld.x)).toBeLessThan(150);
        expect(Math.abs(cy - planetWorld.y)).toBeLessThan(150);
        expect(Math.abs(cz - planetWorld.z)).toBeLessThan(150);
      }
    });

    it('Blue (origin) does not move when spacing changes', () => {
      const ss = new SolarSystem(false);
      const scene = new THREE.Scene();
      ss.addToScene(scene);
      ss.setPlanetSpacing(0.4);
      scene.updateMatrixWorld(true);
      const blueWorld = new THREE.Vector3();
      ss.planets[0].mesh.getWorldPosition(blueWorld);
      expect(blueWorld.length()).toBeLessThan(1e-6);
    });

    it('setPlanetSpacing rebuilds graph edge geometry to match scaled positions', () => {
      const ss = new SolarSystem(false);
      ss.addToScene(new THREE.Scene());
      const before = ss.graphLines.geometry.getAttribute('position').array.slice();
      ss.setPlanetSpacing(2);
      const after = ss.graphLines.geometry.getAttribute('position').array;
      expect(after.length).toBe(before.length);
      for (let i = 0; i < before.length; i++) {
        // Hub positions scale linearly; beam tips also apply def.radius along the chord (unscaled), so 2× is not exact.
        expect(Math.abs(after[i] - before[i] * 2)).toBeLessThan(1.15);
      }
    });

    it('setPlanetSpacing rebuilds interstitial and graph-edge star positions for the new scale', () => {
      const ss = new SolarSystem(false);
      ss.addToScene(new THREE.Scene());
      const before = ss.interstitialStars.geometry.getAttribute('position').array.slice();
      const beforeG = ss.graphEdgeStars.geometry.getAttribute('position').array.slice();
      ss.setPlanetSpacing(2);
      const after = ss.interstitialStars.geometry.getAttribute('position').array;
      const afterG = ss.graphEdgeStars.geometry.getAttribute('position').array;
      expect(after.length).toBe(before.length);
      expect(afterG.length).toBe(beforeG.length);
      let anyDifferent = false;
      for (let i = 0; i < before.length; i += 3) {
        if (Math.abs(after[i] - before[i]) > 1e-3) anyDifferent = true;
      }
      expect(anyDifferent).toBe(true);
      let anyG = false;
      for (let i = 0; i < beforeG.length; i += 3) {
        if (Math.abs(afterG[i] - beforeG[i]) > 1e-3) anyG = true;
      }
      expect(anyG).toBe(true);
    });

    it('getGraphCentroid reflects current spacing scale', () => {
      const ss = new SolarSystem(false);
      const c1 = ss.getGraphCentroid();
      ss.setPlanetSpacing(2);
      const c2 = ss.getGraphCentroid();
      expect(c2.x).toBeCloseTo(c1.x * 2, 3);
      expect(c2.y).toBeCloseTo(c1.y * 2, 3);
      expect(c2.z).toBeCloseTo(c1.z * 2, 3);
    });

    it('setupGUI registers a Planet Graph folder with a Spacing slider', () => {
      const ss = new SolarSystem(false);
      const folder = { add: vi.fn().mockReturnThis(), name: vi.fn().mockReturnThis(), onChange: vi.fn().mockReturnThis(), open: vi.fn() };
      folder.add.mockReturnValue(folder);
      const gui = { addFolder: vi.fn().mockReturnValue(folder) };
      ss.setupGUI(gui);
      expect(gui.addFolder).toHaveBeenCalledWith('Planet Graph');
      expect(folder.add).toHaveBeenCalled();
      expect(folder.name).toHaveBeenCalledWith('Planet Spacing');
    });

    it('getGraphCentroid averages all planet positions', () => {
      const ss = new SolarSystem(false);
      const c = ss.getGraphCentroid();
      const sum = PLANET_DEFS.reduce(
        (a, def) => [a[0] + def.position[0], a[1] + def.position[1], a[2] + def.position[2]],
        [0, 0, 0],
      );
      expect(c.x).toBeCloseTo(sum[0] / PLANET_DEFS.length, 5);
      expect(c.y).toBeCloseTo(sum[1] / PLANET_DEFS.length, 5);
      expect(c.z).toBeCloseTo(sum[2] / PLANET_DEFS.length, 5);
    });
  });

  describe('buildInterstitialStarPositions', () => {
    it('places samples at least INTERSTITIAL_CLEARANCE from every planet center', () => {
      const centers = PLANET_DEFS.map((d) => d.position);
      const buf = buildInterstitialStarPositions(centers, 400, INTERSTITIAL_CLEARANCE);
      for (let i = 0; i < 400; i++) {
        const x = buf[i * 3];
        const y = buf[i * 3 + 1];
        const z = buf[i * 3 + 2];
        for (const c of centers) {
          const dx = x - c[0];
          const dy = y - c[1];
          const dz = z - c[2];
          const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
          expect(d).toBeGreaterThanOrEqual(INTERSTITIAL_CLEARANCE - 0.5);
        }
      }
    });
  });

  describe('buildGraphEdgeStarPositions', () => {
    it('places samples at least INTERSTITIAL_CLEARANCE from every planet center', () => {
      const centers = PLANET_DEFS.map((d) => d.position);
      const buf = buildGraphEdgeStarPositions(centers, 500, INTERSTITIAL_CLEARANCE);
      for (let i = 0; i < 500; i++) {
        const x = buf[i * 3];
        const y = buf[i * 3 + 1];
        const z = buf[i * 3 + 2];
        for (const c of centers) {
          const dx = x - c[0];
          const dy = y - c[1];
          const dz = z - c[2];
          const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
          expect(d).toBeGreaterThanOrEqual(INTERSTITIAL_CLEARANCE - 0.5);
        }
      }
    });
  });

  describe('computeKnnEdges', () => {
    it('returns a deduplicated set of canonical "i-j" (i<j) keys', () => {
      const positions = [[0, 0, 0], [1, 0, 0], [10, 0, 0], [11, 0, 0]];
      const edges = computeKnnEdges(positions, 1);
      for (const key of edges) {
        const [a, b] = key.split('-').map(Number);
        expect(a).toBeLessThan(b);
      }
    });

    it('1-NN of a 4-point chain produces 2 edges (mutual nearest pairs)', () => {
      const positions = [[0, 0, 0], [1, 0, 0], [10, 0, 0], [11, 0, 0]];
      const edges = computeKnnEdges(positions, 1);
      expect(edges.has('0-1')).toBe(true);
      expect(edges.has('2-3')).toBe(true);
      expect(edges.size).toBe(2);
    });

    it('k >= n-1 yields the complete graph (n*(n-1)/2 edges)', () => {
      const n = 5;
      const positions = Array.from({ length: n }, (_, i) => [i, i * 2, i * 3]);
      const edges = computeKnnEdges(positions, n - 1);
      expect(edges.size).toBe((n * (n - 1)) / 2);
    });

    it('k=0 or n<2 yields no edges', () => {
      expect(computeKnnEdges([[0, 0, 0], [1, 1, 1]], 0).size).toBe(0);
      expect(computeKnnEdges([[0, 0, 0]], 2).size).toBe(0);
      expect(computeKnnEdges([], 5).size).toBe(0);
    });

    it('every planet appears in at least one edge for the real PLANET_DEFS at k=2', () => {
      const positions = PLANET_DEFS.map((d) => d.position);
      const edges = computeKnnEdges(positions, 2);
      const seen = new Set();
      for (const key of edges) {
        for (const idx of key.split('-')) seen.add(Number(idx));
      }
      for (let i = 0; i < positions.length; i++) {
        expect(seen.has(i)).toBe(true);
      }
    });
  });

  describe('countGraphLineVertices (leaf-aware graph lasers)', () => {
    it('doubles vertex count for an isolated two-node edge (both degree 1)', () => {
      const positions = [[0, 0, 0], [100, 0, 0]];
      const edges = computeKnnEdges(positions, 1);
      expect(edges.size).toBe(1);
      expect(countGraphLineVertices(edges, 2, GRAPH_LASER_FAN_BEAMS)).toBe(
        GRAPH_LASER_FAN_BEAMS * 2 * 2,
      );
    });
  });

  describe('tryTriggerRedPlanetOnBeat', () => {
    it('triggers once per beat onset, not on sustained isBeat frames', () => {
      const ss = new SolarSystem(false);
      const triggerSpy = vi.spyOn(ss._redPlanetHalves, 'trigger');
      ss.tryTriggerRedPlanetOnBeat(true);
      ss.tryTriggerRedPlanetOnBeat(true);
      expect(triggerSpy).toHaveBeenCalledTimes(1);
      ss.tryTriggerRedPlanetOnBeat(false);
      ss.tryTriggerRedPlanetOnBeat(true);
      expect(triggerSpy).toHaveBeenCalledTimes(2);
    });
  });

  describe('spectrumToGraphEqBands', () => {
    it(`returns ${GRAPH_EQ_BAR_COUNT} contiguous band averages`, () => {
      const n = 1024;
      const spec = new Float32Array(n);
      for (let i = 0; i < n; i++) spec[i] = (i % 8) / 8;
      const bands = spectrumToGraphEqBands(spec);
      expect(bands.length).toBe(GRAPH_EQ_BAR_COUNT);
      let sumBins = 0;
      for (let b = 0; b < GRAPH_EQ_BAR_COUNT; b++) {
        const i0 = Math.floor((b * n) / GRAPH_EQ_BAR_COUNT);
        const i1 = Math.floor(((b + 1) * n) / GRAPH_EQ_BAR_COUNT);
        let expected = 0;
        const hi = Math.max(i0 + 1, i1);
        for (let i = i0; i < hi; i++) expected += spec[i];
        expected /= hi - i0;
        expect(bands[b]).toBeCloseTo(expected, 5);
        sumBins += hi - i0;
      }
      expect(sumBins).toBe(n);
    });
  });
});
