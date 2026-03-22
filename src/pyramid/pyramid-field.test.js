/** @vitest-environment jsdom */
import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import PyramidField from './pyramid-field.js';
import ShardShatter from './shard-shatter.js';

describe('PyramidField', () => {
  // ── constructor ────────────────────────────────────────────────────────

  describe('constructor', () => {
    it('creates with default config (count=60)', () => {
      const pf = new PyramidField();
      expect(pf.config.count).toBe(60);
      expect(pf.config.shardDrift).toBe(0.05);
      expect(pf._barDuration).toBe(2.0);
    });

    it('accepts custom config values', () => {
      const pf = new PyramidField({ count: 20, orbitRadius: 3, size: 0.2 });
      expect(pf.config.count).toBe(20);
      expect(pf.config.orbitRadius).toBe(3);
      expect(pf.config.size).toBe(0.2);
    });

    it('creates one Mesh per shard (no clusters)', () => {
      const pf = new PyramidField({ count: 10 });
      expect(pf._shards.length).toBe(10);
      pf._shards.forEach(s => expect(s.mesh).toBeInstanceOf(THREE.Mesh));
    });

    it('creates a single shared ConeGeometry', () => {
      const pf = new PyramidField({ count: 5 });
      expect(pf._geometry).toBeInstanceOf(THREE.ConeGeometry);
    });

    it('all shards share the same geometry', () => {
      const pf = new PyramidField({ count: 5 });
      const geo = pf._geometry;
      pf._shards.forEach(s => expect(s.mesh.geometry).toBe(geo));
    });

    it('distributes shards on a sphere at orbitRadius', () => {
      const pf = new PyramidField({ count: 20 });
      for (const s of pf._shards) {
        const d = s.mesh.position.length();
        expect(d).toBeCloseTo(pf.config.orbitRadius, 1);
      }
    });

    it('handles count=1 without dividing by zero', () => {
      const pf = new PyramidField({ count: 1 });
      expect(pf._shards.length).toBe(1);
      const pos = pf._shards[0].mesh.position;
      expect(Number.isFinite(pos.x)).toBe(true);
      expect(Number.isFinite(pos.y)).toBe(true);
      expect(Number.isFinite(pos.z)).toBe(true);
    });

    it('creates a THREE.Group as the root', () => {
      const pf = new PyramidField({ count: 2 });
      expect(pf.group).toBeInstanceOf(THREE.Group);
    });

    it('creates a MeshStandardMaterial with expected properties', () => {
      const pf = new PyramidField({ count: 1 });
      expect(pf.material).toBeInstanceOf(THREE.MeshStandardMaterial);
      expect(pf.material.color.getHex()).toBe(0x60a5fa);
      expect(pf.material.metalness).toBe(0.3);
      expect(pf.material.roughness).toBe(0.5);
      expect(pf.material.transparent).toBe(true);
      expect(pf.material.opacity).toBe(0.9);
    });

    it('adds shard meshes as children of the root group', () => {
      const pf = new PyramidField({ count: 4 });
      expect(pf.group.children.length).toBe(5);
      const meshes = pf.group.children.filter(c => c instanceof THREE.Mesh);
      expect(meshes.length).toBe(4);
      expect(pf.group.children.some(c => c instanceof THREE.Group)).toBe(true);
    });

    it('each shard has sizeMult, driftDir, driftMult, and dir', () => {
      const pf = new PyramidField({ count: 3 });
      pf._shards.forEach(s => {
        expect(typeof s.sizeMult).toBe('number');
        expect(s.sizeMult).toBeGreaterThanOrEqual(0.7);
        expect(s.sizeMult).toBeLessThanOrEqual(1.3);
        expect(s.driftDir === 1 || s.driftDir === -1).toBe(true);
        expect(typeof s.driftMult).toBe('number');
        expect(s.dir).toBeInstanceOf(THREE.Vector3);
      });
    });

    it('initializes orbit state', () => {
      const pf = new PyramidField({ count: 1 });
      expect(pf._orbitTime).toBe(0);
    });
  });

  // ── update ─────────────────────────────────────────────────────────────

  describe('update', () => {
    it('rotates the group', () => {
      const pf = new PyramidField({ count: 5 });
      pf.update(1.0);
      expect(pf.group.rotation.y).toBeCloseTo(pf.config.rotationSpeed);
    });

    it('applies gentle drift rotation to each shard', () => {
      const pf = new PyramidField({ count: 5 });
      const rotBefore = pf._shards.map(s => s.mesh.rotation.y);
      pf.update(1.0);
      pf._shards.forEach((s, i) => {
        expect(s.mesh.rotation.y).not.toBe(rotBefore[i]);
      });
    });

    it('accumulates rotation over multiple calls', () => {
      const pf = new PyramidField({ count: 1 });
      pf.update(0.5);
      pf.update(0.5);
      expect(pf.group.rotation.y).toBeCloseTo(0.15);
    });

    it('handles zero deltaTime (no change)', () => {
      const pf = new PyramidField({ count: 1 });
      const before = pf.group.rotation.y;
      pf.update(0);
      expect(pf.group.rotation.y).toBe(before);
    });

    it('calls _shatter.update when _shatter is set', () => {
      const pf = new PyramidField({ count: 2 });
      const spy = vi.spyOn(pf._shatter, 'update');
      pf.update(0.016);
      expect(spy).toHaveBeenCalledWith(0.016, pf._barDuration);
    });
  });

  // ── applySpectrum ──────────────────────────────────────────────────────

  describe('applySpectrum', () => {
    it('does not crash with null spectrum', () => {
      const pf = new PyramidField({ count: 5 });
      expect(() => pf.applySpectrum(null)).not.toThrow();
    });

    it('does not crash with empty spectrum', () => {
      const pf = new PyramidField({ count: 5 });
      expect(() => pf.applySpectrum(new Float32Array(0))).not.toThrow();
    });

    it('applies subtle scale changes with energy', () => {
      const pf = new PyramidField({ count: 10 });
      const spectrum = new Float32Array(64).fill(0.5);
      pf.applySpectrum(spectrum);
      for (const s of pf._shards) {
        expect(s.mesh.scale.x).not.toBe(s.sizeMult);
      }
    });

    it('stores the spectrum reference', () => {
      const pf = new PyramidField({ count: 1 });
      const spectrum = new Float32Array(16);
      pf.applySpectrum(spectrum);
      expect(pf._spectrum).toBe(spectrum);
    });

    it('handles spectrum shorter than shard count', () => {
      const pf = new PyramidField({ count: 10 });
      const spectrum = new Float32Array([0.5, 0.5, 0.5, 0.5]);
      expect(() => pf.applySpectrum(spectrum)).not.toThrow();
    });

    it('handles very large spectrum (512 bins)', () => {
      const pf = new PyramidField({ count: 5 });
      const spectrum = new Float32Array(512).fill(0.3);
      expect(() => pf.applySpectrum(spectrum)).not.toThrow();
    });

    it('pushes shards outward with energy', () => {
      const pf = new PyramidField({ count: 5 });
      const distBefore = pf._shards.map(s => s.mesh.position.length());
      const spectrum = new Float32Array(64).fill(1.0);
      pf.applySpectrum(spectrum);
      pf._shards.forEach((s, i) => {
        expect(s.mesh.position.length()).toBeGreaterThan(distBefore[i]);
      });
    });

    it('leaves scale at sizeMult with zero spectrum', () => {
      const pf = new PyramidField({ count: 5 });
      const spectrum = new Float32Array(64).fill(0);
      pf.applySpectrum(spectrum);
      for (const s of pf._shards) {
        expect(s.mesh.scale.x).toBeCloseTo(s.sizeMult);
      }
    });
  });

  // ── dispose ────────────────────────────────────────────────────────────

  describe('dispose', () => {
    it('clears shards and disposes geometry and material', () => {
      const pf = new PyramidField({ count: 5 });
      const geoSpy = vi.spyOn(pf._geometry, 'dispose');
      const matSpy = vi.spyOn(pf.material, 'dispose');
      pf.dispose();
      expect(pf._shards.length).toBe(0);
      expect(geoSpy).toHaveBeenCalled();
      expect(matSpy).toHaveBeenCalled();
    });

    it('removes meshes from the group', () => {
      const pf = new PyramidField({ count: 3 });
      pf.dispose();
      expect(pf.group.children.length).toBe(0);
    });

    it('calls _shatter.dispose when _shatter is set', () => {
      const pf = new PyramidField({ count: 2 });
      const spy = vi.spyOn(pf._shatter, 'dispose');
      pf.dispose();
      expect(spy).toHaveBeenCalled();
    });

    it('is safe to call twice', () => {
      const pf = new PyramidField({ count: 2 });
      pf.dispose();
      expect(() => pf.dispose()).not.toThrow();
    });
  });

  // ── _disposeContents ───────────────────────────────────────────────────

  describe('_disposeContents', () => {
    it('empties _shards and disposes geometry', () => {
      const pf = new PyramidField({ count: 3 });
      const geoSpy = vi.spyOn(pf._geometry, 'dispose');
      pf._disposeContents();
      expect(pf._shards.length).toBe(0);
      expect(geoSpy).toHaveBeenCalled();
    });

    it('does not dispose the material (only dispose() does that)', () => {
      const pf = new PyramidField({ count: 1 });
      const spy = vi.spyOn(pf.material, 'dispose');
      pf._disposeContents();
      expect(spy).not.toHaveBeenCalled();
    });
  });

  // ── rebuild ────────────────────────────────────────────────────────────

  describe('rebuild', () => {
    it('clears and recreates shards when called', () => {
      const pf = new PyramidField({ count: 5 });
      pf.config.count = 3;
      pf.rebuild();
      expect(pf._shards.length).toBe(3);
    });

    it('disposes old geometry on rebuild', () => {
      const pf = new PyramidField({ count: 2 });
      const oldGeo = pf._geometry;
      const spy = vi.spyOn(oldGeo, 'dispose');
      pf.rebuild();
      expect(spy).toHaveBeenCalled();
    });

    it('removes old meshes from the group', () => {
      const pf = new PyramidField({ count: 3 });
      expect(pf.group.children.length).toBe(4);
      pf.config.count = 1;
      pf.rebuild();
      expect(pf.group.children.length).toBe(2);
    });

    it('creates a new geometry after rebuild', () => {
      const pf = new PyramidField({ count: 1 });
      const oldGeo = pf._geometry;
      pf.rebuild();
      expect(pf._geometry).not.toBe(oldGeo);
      expect(pf._geometry).toBeInstanceOf(THREE.ConeGeometry);
    });
  });

  // ── setupGUI ───────────────────────────────────────────────────────────

  describe('setupGUI', () => {
    it('creates Pyramids folder with expected controls', () => {
      const pf = new PyramidField({ count: 2 });
      const addCalls = [];
      const mockFolder = {
        add: vi.fn((...args) => {
          addCalls.push(args[1]);
          return { name: vi.fn().mockReturnValue({ onChange: vi.fn() }) };
        }),
        open: vi.fn(),
      };
      const mockGui = { addFolder: vi.fn(() => mockFolder) };
      pf.setupGUI(mockGui);
      expect(mockGui.addFolder).toHaveBeenCalledWith('Pyramids');
      expect(addCalls).toContain('count');
      expect(addCalls).toContain('shardDrift');
      expect(addCalls).toContain('orbitRadius');
      expect(addCalls).toContain('size');
      expect(addCalls).toContain('rotationSpeed');
      expect(addCalls).toContain('tweenSpeed');
      expect(addCalls).toContain('orbitPulseSpeed');
      expect(addCalls).toContain('maxSimultaneousShatter');
    });

    it('opens the folder by default', () => {
      const pf = new PyramidField({ count: 1 });
      const mockFolder = {
        add: vi.fn().mockReturnValue({ name: vi.fn().mockReturnValue({ onChange: vi.fn() }) }),
        open: vi.fn(),
      };
      const mockGui = { addFolder: vi.fn(() => mockFolder) };
      pf.setupGUI(mockGui);
      expect(mockFolder.open).toHaveBeenCalled();
    });

    it('returns the folder', () => {
      const pf = new PyramidField({ count: 1 });
      const mockFolder = {
        add: vi.fn().mockReturnValue({ name: vi.fn().mockReturnValue({ onChange: vi.fn() }) }),
        open: vi.fn(),
      };
      const mockGui = { addFolder: vi.fn(() => mockFolder) };
      const result = pf.setupGUI(mockGui);
      expect(result).toBe(mockFolder);
    });
  });

  // ── setKeyframes ───────────────────────────────────────────────────────

  describe('setKeyframes', () => {
    function makeSpectrum(value, length = 64) {
      return new Float32Array(length).fill(value);
    }

    it('stores per-shard energy keyframes when given valid spectra', () => {
      const pf = new PyramidField({ count: 5 });
      pf.setKeyframes([makeSpectrum(0.5), makeSpectrum(1.0)]);
      expect(pf._keyframes).not.toBeNull();
      expect(pf._keyframes.length).toBe(2);
      expect(pf._keyframes[0].length).toBe(5);
      expect(pf._keyframes[1].length).toBe(5);
    });

    it('clears keyframes when given null', () => {
      const pf = new PyramidField({ count: 5 });
      pf.setKeyframes([makeSpectrum(0.5)]);
      pf.setKeyframes(null);
      expect(pf._keyframes).toBeNull();
    });

    it('clears keyframes when given empty array', () => {
      const pf = new PyramidField({ count: 5 });
      pf.setKeyframes([makeSpectrum(0.5)]);
      pf.setKeyframes([]);
      expect(pf._keyframes).toBeNull();
    });

    it('resets tweenTime to 0', () => {
      const pf = new PyramidField({ count: 5 });
      pf._tweenTime = 10;
      pf.setKeyframes([makeSpectrum(0.3), makeSpectrum(0.7)]);
      expect(pf._tweenTime).toBe(0);
    });

    it('sets tweenDuration from songDuration', () => {
      const pf = new PyramidField({ count: 5 });
      const spectra = Array.from({ length: 5 }, () => makeSpectrum(0.5));
      pf.setKeyframes(spectra, 100);
      expect(pf._tweenDuration).toBeCloseTo(20);
    });

    it('falls back to 3s per transition when songDuration is 0', () => {
      const pf = new PyramidField({ count: 5 });
      pf.setKeyframes([makeSpectrum(0.3), makeSpectrum(0.7)], 0);
      expect(pf._tweenDuration).toBe(3);
    });

    it('falls back to 3s per transition with only 1 keyframe', () => {
      const pf = new PyramidField({ count: 5 });
      pf.setKeyframes([makeSpectrum(0.5)], 60);
      expect(pf._tweenDuration).toBe(3);
    });

    it('tween skips shattered shards', () => {
      const pf = new PyramidField({ count: 10 });
      pf.setKeyframes([makeSpectrum(0), makeSpectrum(1.0)], 6);
      pf.onBeat({ isBeat: true, intensity: 1.0, barDuration: 2.0 });
      const shatteredIdx = pf._shards.findIndex((_, i) => pf._shatter.isShattered(i));
      if (shatteredIdx >= 0) {
        expect(pf._shards[shatteredIdx].mesh.visible).toBe(false);
      }
      pf.update(1.5);
      if (shatteredIdx >= 0 && pf._shatter.isShattered(shatteredIdx)) {
        expect(pf._shards[shatteredIdx].mesh.visible).toBe(false);
      }
    });

    it('applies tween energy to non-shattered shards', () => {
      const pf = new PyramidField({ count: 5 });
      pf.setKeyframes([makeSpectrum(0), makeSpectrum(1.0)], 10);
      const scaleBefore = pf._shards[0].mesh.scale.x;
      pf.update(1.0);
      expect(pf._shards[0].mesh.scale.x).not.toBeCloseTo(scaleBefore, 3);
    });
  });

  describe('shatter integration', () => {
    it('creates a ShardShatter instance internally', () => {
      const pf = new PyramidField({ count: 10 });
      expect(pf._shatter).toBeInstanceOf(ShardShatter);
    });

    it('triggers shatters on beat', () => {
      const pf = new PyramidField({ count: 10 });
      pf.onBeat({ isBeat: true, intensity: 0.5, barDuration: 2.0 });
      const anyShattered = pf._shards.some((_, i) => pf._shatter.isShattered(i));
      expect(anyShattered).toBe(true);
    });

    it('does not shatter on non-beat', () => {
      const pf = new PyramidField({ count: 10 });
      pf.onBeat({ isBeat: false, intensity: 0.5, barDuration: 2.0 });
      const anyShattered = pf._shards.some((_, i) => pf._shatter.isShattered(i));
      expect(anyShattered).toBe(false);
    });

    it('hides shard mesh when shattered', () => {
      const pf = new PyramidField({ count: 10 });
      pf.onBeat({ isBeat: true, intensity: 1.0, barDuration: 2.0 });
      const hidden = pf._shards.filter(s => !s.mesh.visible);
      expect(hidden.length).toBeGreaterThan(0);
    });

    it('restores shard visibility after recombination', () => {
      const pf = new PyramidField({ count: 10, maxSimultaneousShatter: 10 });
      pf.onBeat({ isBeat: true, intensity: 0.5, barDuration: 2.0 });
      pf.update(3.0);
      pf._shards.forEach(s => expect(s.mesh.visible).toBe(true));
    });

    it('disposes ShardShatter on dispose', () => {
      const pf = new PyramidField({ count: 5 });
      const spy = vi.spyOn(pf._shatter, 'dispose');
      pf.dispose();
      expect(spy).toHaveBeenCalled();
    });
  });
});
