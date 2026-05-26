/** @vitest-environment jsdom */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as THREE from "three";
import {
  PlanetHalvesEffect,
  planetHalfSeparationFactorFromLoudness,
  planetShatterSeparationFactor,
  createSphereHalvesGeometries,
  splitSphereGeometryAtEquator,
  createPlanetHalfInteriorMaterial,
  PLANET_HALF_INTERIOR_GROUP,
  PLANET_HALF_SHELL_GROUP,
  PLANET_SHATTER_BURST_END,
  PLANET_SHATTER_HOLD_END,
  PLANET_SHATTER_REUNITE_QUIET_SEC,
} from "./planet-shatter.js";

describe("planetHalfSeparationFactorFromLoudness", () => {
  it("maps 0 to the minimum separation floor and 1 to full span", () => {
    expect(planetHalfSeparationFactorFromLoudness(0)).toBeLessThan(0.15);
    expect(planetHalfSeparationFactorFromLoudness(1)).toBe(1);
  });
});

describe("planetShatterSeparationFactor", () => {
  it("starts at 0 and returns to 0 at t=1", () => {
    expect(planetShatterSeparationFactor(0)).toBe(0);
    expect(planetShatterSeparationFactor(1)).toBeCloseTo(0, 5);
  });

  it("peaks during the hold window", () => {
    const midHold = (PLANET_SHATTER_BURST_END + PLANET_SHATTER_HOLD_END) * 0.5;
    expect(planetShatterSeparationFactor(midHold)).toBe(1);
  });

  it("overshoots slightly during burst (bounce-apart)", () => {
    const earlyBurst = PLANET_SHATTER_BURST_END * 0.85;
    const linear = earlyBurst / PLANET_SHATTER_BURST_END;
    expect(planetShatterSeparationFactor(earlyBurst)).toBeGreaterThan(linear * 0.95);
  });
});

function maxVertexY(geometry) {
  const pos = geometry.getAttribute("position");
  let maxY = -Infinity;
  for (let i = 0; i < pos.count; i++) {
    maxY = Math.max(maxY, pos.getY(i));
  }
  return maxY;
}

function minVertexY(geometry) {
  const pos = geometry.getAttribute("position");
  let minY = Infinity;
  for (let i = 0; i < pos.count; i++) {
    minY = Math.min(minY, pos.getY(i));
  }
  return minY;
}

describe("splitSphereGeometryAtEquator", () => {
  it("builds watertight capped solids with normals", () => {
    const full = new THREE.SphereGeometry(0.6, 24, 24);
    const { positive, negative } = splitSphereGeometryAtEquator(full);
    full.dispose();
    expect(positive.getAttribute("normal")).toBeTruthy();
    expect(negative.getAttribute("normal")).toBeTruthy();
    expect(positive.groups.length).toBe(2);
    expect(positive.groups[1].materialIndex).toBe(PLANET_HALF_INTERIOR_GROUP);
    expect(positive.groups[0].materialIndex).toBe(PLANET_HALF_SHELL_GROUP);
    expect(positive.getAttribute("position").count).toBeGreaterThan(100);
    expect(negative.getAttribute("position").count).toBeGreaterThan(100);
    expect(maxVertexY(positive)).toBeLessThanOrEqual(0.6 + 1e-3);
    expect(minVertexY(positive)).toBeGreaterThanOrEqual(-1e-3);
    expect(maxVertexY(negative)).toBeLessThanOrEqual(1e-3);
    expect(minVertexY(negative)).toBeGreaterThanOrEqual(-0.6 - 1e-3);
    positive.dispose();
    negative.dispose();
  });

  it("includes cap faces at the equator (vertices on y ≈ 0)", () => {
    const full = new THREE.SphereGeometry(0.6, 32, 32);
    const { positive } = splitSphereGeometryAtEquator(full);
    full.dispose();
    const pos = positive.getAttribute("position");
    let onEquator = 0;
    for (let i = 0; i < pos.count; i++) {
      if (Math.abs(pos.getY(i)) < 1e-4) onEquator++;
    }
    expect(onEquator).toBeGreaterThan(10);
    positive.dispose();
  });
});

describe("createPlanetHalfInteriorMaterial", () => {
  it("is white with emissive glow", () => {
    const mat = createPlanetHalfInteriorMaterial();
    expect(mat.color.getHex()).toBe(0xffffff);
    expect(mat.emissive.getHex()).toBe(0xffffff);
    expect(mat.emissiveIntensity).toBeGreaterThan(0);
    mat.dispose();
  });
});

describe("createSphereHalvesGeometries", () => {
  it("returns capped buffer geometries from a full sphere", () => {
    const [upper, lower] = createSphereHalvesGeometries(0.6, 16, 16);
    expect(upper).toBeInstanceOf(THREE.BufferGeometry);
    expect(lower).toBeInstanceOf(THREE.BufferGeometry);
    expect(upper.getAttribute("normal")).toBeTruthy();
    upper.dispose();
    lower.dispose();
  });
});

describe("PlanetHalvesEffect", () => {
  /** @type {THREE.Mesh} */
  let mesh;
  /** @type {THREE.Group} */
  let pivot;

  beforeEach(() => {
    mesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.6, 16, 16),
      new THREE.MeshPhysicalMaterial({ color: 0xf87171 })
    );
    pivot = new THREE.Group();
    pivot.add(mesh);
  });

  afterEach(() => {
    mesh.geometry.dispose();
    mesh.material.dispose();
  });

  it("uses white interior material on the cut face", () => {
    const planet = { mesh, pivot, def: { radius: 0.6 } };
    const effect = new PlanetHalvesEffect(planet);
    effect.trigger();
    const [upper] = effect._halves;
    expect(Array.isArray(upper.material)).toBe(true);
    expect(upper.material[PLANET_HALF_INTERIOR_GROUP].color.getHex()).toBe(0xffffff);
    effect.dispose();
  });

  it("hides the planet mesh and reunites after the animation", () => {
    const planet = { mesh, pivot, def: { radius: 0.6 } };
    const effect = new PlanetHalvesEffect(planet);
    effect.trigger();
    expect(mesh.visible).toBe(false);
    expect(effect.active).toBe(true);
    const steps = Math.ceil(1.5 / 0.016) + 2;
    for (let i = 0; i < steps; i++) {
      effect.update(0.016);
    }
    expect(effect.active).toBe(false);
    expect(mesh.visible).toBe(true);
    effect.dispose();
  });

  it("restarts cleanly when triggered mid-animation", () => {
    const planet = { mesh, pivot, def: { radius: 0.6 } };
    const effect = new PlanetHalvesEffect(planet);
    effect.trigger();
    effect.update(0.4);
    effect.trigger();
    expect(effect.active).toBe(true);
    expect(effect._elapsed).toBe(0);
    effect.dispose();
  });

  it("scales half separation with loudness while music-driven", () => {
    const planet = { mesh, pivot, def: { radius: 0.6 } };
    const effect = new PlanetHalvesEffect(planet);
    effect.trigger();
    effect.setLoudnessDrive(0.2);
    for (let i = 0; i < 20; i++) effect.update(0.016);
    const lowSep = effect._halves[0].position.y;

    effect.setLoudnessDrive(1);
    for (let i = 0; i < 30; i++) effect.update(0.016);
    const highSep = effect._halves[0].position.y;

    expect(highSep).toBeGreaterThan(lowSep);
    effect.dispose();
  });

  it("reunites after loudness drops in music-driven mode", () => {
    const planet = { mesh, pivot, def: { radius: 0.6 } };
    const effect = new PlanetHalvesEffect(planet);
    effect.trigger();
    effect.setLoudnessDrive(0.8);
    for (let i = 0; i < 20; i++) effect.update(0.016);
    effect.setLoudnessDrive(0);
    const steps = Math.ceil(PLANET_SHATTER_REUNITE_QUIET_SEC / 0.016) + 30;
    for (let i = 0; i < steps; i++) effect.update(0.016);
    expect(effect.active).toBe(false);
    expect(mesh.visible).toBe(true);
    effect.dispose();
  });
});
