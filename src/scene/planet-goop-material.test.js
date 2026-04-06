/** @vitest-environment jsdom */

import { describe, it, expect } from "vitest";
import * as THREE from "three";
import {
  attachPlanetInteriorGoop,
  createPlanetGoopMaterial,
  PLANET_GOOP_INNER_SCALE,
} from "./planet-goop-material.js";

describe("planet-goop-material", () => {
  it("creates shader material with BackSide for interior visibility", () => {
    const mat = createPlanetGoopMaterial(0xff0000);
    expect(mat.side).toBe(THREE.BackSide);
    expect(mat.uniforms.uTime).toBeDefined();
    expect(mat.uniforms.uTint).toBeDefined();
  });

  it("attaches inner mesh scaled below outer radius", () => {
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(1, 16, 16),
      new THREE.MeshBasicMaterial()
    );
    const def = { radius: 1, color: 0x60a5fa };
    attachPlanetInteriorGoop(mesh, def, true);
    const inner = mesh.children.find((c) => c.name === "planetInteriorGoop");
    expect(inner).toBeDefined();
    expect(inner.geometry.parameters.radius).toBeCloseTo(PLANET_GOOP_INNER_SCALE);
  });
});
