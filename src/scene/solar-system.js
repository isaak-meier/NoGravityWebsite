import * as THREE from "/node_modules/three/build/three.module.js";

const PLANET_DEFS = [
  { color: 0x60a5fa, radius: 0.9, orbit: 12, speed: 0.3,  label: "Blue"   },
  { color: 0xf87171, radius: 0.6, orbit: 20, speed: 0.2,  label: "Red"    },
  { color: 0x4ade80, radius: 1.1, orbit: 30, speed: 0.12, label: "Green"  },
  { color: 0xfbbf24, radius: 0.5, orbit: 40, speed: 0.08, label: "Gold"   },
  { color: 0xa78bfa, radius: 0.75, orbit: 52, speed: 0.05, label: "Violet" },
];

class SolarSystem {
  constructor(isMobile = false) {
    this.isMobile = isMobile;
    this.sun = this._createSun();
    this.sunLight = null;
    this.planets = PLANET_DEFS.map((def) => this._createPlanet(def));
    this.starField = this._createStars();
  }

  get primary() {
    return this.planets[0];
  }

  addToScene(scene) {
    // Place sun far from blue planet (Earth-Sun distance ~150 million km, scale for scene)
    // Assume blue planet is at orbit=12, so sun should be at (12 + 150) units along X
    this.sun.position.set(162, 0, 0); // 12 (blue planet orbit) + 150 (scaled distance)
    scene.add(this.sun);
    for (let i = 0; i < this.planets.length; i++) {
      if (i === 0) {
        this.planets[i].pivot.visible = true;
      } else {
        this.planets[i].pivot.visible = false;
      }
      scene.add(this.planets[i].pivot);
    }
    scene.add(this.starField);
    this.sunLight = this._setupLights(scene);
  }

  update(dt) {
      for (const p of this.planets) {
        // p.pivot.rotation.y += dt * p.def.speed; // Orbit disabled
        p.mesh.rotation.y += dt * 0.2;
        p.mesh.rotation.x += dt * 0.08;
      }
      this.starField.rotation.y += dt * 0.001;
  }

  _createSun() {
    const segs = this.isMobile ? 24 : 48;
    const geo = new THREE.SphereGeometry(6, segs, segs); // Increased radius from 3 to 6
    const mat = new THREE.MeshBasicMaterial({ color: 0xffcc33 });
    const sun = new THREE.Mesh(geo, mat);
    sun.layers.enable(1);
    return sun;
  }

  _createPlanet(def) {
    const segs = this.isMobile ? 32 : 64;
    const geo = new THREE.SphereGeometry(def.radius, segs, segs);
    const mat = new THREE.MeshPhysicalMaterial({
      color: def.color,
      metalness: 0.2,
      roughness: 0.7,
      clearcoat: 0.5,
      clearcoatRoughness: 0.1,
      reflectivity: 0.9,
    });
    const mesh = new THREE.Mesh(geo, mat);
    const pivot = new THREE.Group();
    mesh.position.set(def.orbit, 0, 0);
    pivot.add(mesh);
    pivot.rotation.y = Math.random() * Math.PI * 2;
    return { mesh, material: mat, pivot, def };
  }

  _createStars() {
    const starsGeo = new THREE.BufferGeometry();
    const count = this.isMobile ? 1200 : 3000;
    const pos = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const r = 200 + Math.random() * 600;
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

  _setupLights(scene) {
    const sunLight = new THREE.PointLight(0xfff3d6, 6, 300, 0.64); // Increased intensity
    sunLight.position.set(0, 0, 0);
    scene.add(sunLight);
    scene.add(new THREE.AmbientLight(0x6b6f88, 0.5)); // Increased ambient
    scene.add(new THREE.HemisphereLight(0xddeeff, 0x101020, 0.5));
    return sunLight;
  }
}

export { PLANET_DEFS };
export default SolarSystem;
