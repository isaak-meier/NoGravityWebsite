import * as THREE from "/node_modules/three/build/three.module.js";

class CameraController {
  constructor(container, camera) {
    this.camera = camera;
    this.container = container;
    this.mouseX = 0;
    this.mouseY = 0;
    this.targetZ = camera.position.z;
    this.keys = { w: false, a: false, s: false, d: false, q: false, e: false };
    this.moveSpeed = 30;
    this.startDistance = 300;
    this.zoomTarget = new THREE.Vector3(0, 5, 25);
    this.zoomActive = true;
    this.zoomSpeed = 0.02;
    this.followPlanet = null;
    this.mouseLookEnabled = true;
    this.sun = null;
    this.sunLight = null;
    this._attach(container);
  }

  _attach(container) {
    container.addEventListener("mousemove", (e) => {
      const rect = container.getBoundingClientRect();
      this.mouseX = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      this.mouseY = ((e.clientY - rect.top) / rect.height) * 2 - 1;
    });
    container.addEventListener("contextmenu", (e) => e.preventDefault());
    window.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        const dir = new THREE.Vector3();
        this.camera.getWorldDirection(dir);
        const amt = -e.deltaY * 0.05;
        this.camera.position.addScaledVector(dir, amt);
      },
      { passive: false }
    );
    window.addEventListener("keydown", (e) => {
      const k = e.key.toLowerCase();
      if (k in this.keys) this.keys[k] = true;
      if (e.key === "Escape") {
        this.followPlanet = null;
        this.mouseLookEnabled = !this.mouseLookEnabled;
      }
    });
    window.addEventListener("keyup", (e) => {
      const k = e.key.toLowerCase();
      if (k in this.keys) this.keys[k] = false;
    });
    this._attachTouch(container);
  }

  _attachTouch(container) {
    let isPinching = false;
    let pinchStartDist = 0;
    let pinchStartZ = this.targetZ;
    container.addEventListener(
      "touchstart",
      (e) => {
        if (e.touches.length === 2) {
          isPinching = true;
          const dx = e.touches[0].clientX - e.touches[1].clientX;
          const dy = e.touches[0].clientY - e.touches[1].clientY;
          pinchStartDist = Math.hypot(dx, dy);
          pinchStartZ = this.targetZ;
          e.preventDefault();
        }
      },
      { passive: false }
    );
    container.addEventListener(
      "touchmove",
      (e) => {
        if (isPinching && e.touches.length === 2) {
          const dx = e.touches[0].clientX - e.touches[1].clientX;
          const dy = e.touches[0].clientY - e.touches[1].clientY;
          const dist = Math.hypot(dx, dy);
          if (pinchStartDist > 0) {
            const ratio = pinchStartDist / dist;
            this.targetZ = pinchStartZ * ratio;
          }
          e.preventDefault();
        }
      },
      { passive: false }
    );
    container.addEventListener("touchend", (e) => {
      if (e.touches.length < 2) isPinching = false;
    });
  }

  setupFollowHandler(renderer, planets) {
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();

    renderer.domElement.addEventListener("click", (e) => {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, this.camera);

      let closest = null;
      let closestDist = Infinity;
      const wp = new THREE.Vector3();

      for (const p of planets) {
        p.mesh.getWorldPosition(wp);
        const dist = raycaster.ray.distanceToPoint(wp);
        const threshold = Math.max(p.def.radius * 5, 3);
        if (dist < threshold && dist < closestDist) {
          closestDist = dist;
          closest = p;
        }
      }

      if (closest) {
        this.followPlanet = closest;
        this.zoomActive = false;
      } else {
        this.followPlanet = null;
      }
    });
  }

  setupGUI(gui) {
    const camFolder = gui.addFolder("Camera");
    camFolder.add(this, "startDistance", 50, 800).name("Start Distance").onChange((v) => {
      this.zoomTarget.set(0, 5, 25);
      this.camera.position.set(0, v * 0.27, v);
      this.zoomActive = true;
    });
    camFolder.add(this, "zoomSpeed", 0.005, 0.1).name("Zoom Speed");
    camFolder.open();
  }

  update(dt) {
    // Disengage follow if WASD pressed
    if (this.followPlanet) {
      if (this.keys.w || this.keys.a || this.keys.s || this.keys.d || this.keys.q || this.keys.e) {
        this.followPlanet = null;
      }
    }
    // Keep sun at small scale always
    if (this.sun) {
      this.sun.scale.setScalar(0.04);
    }
    if (this.sunLight) {
      this.sunLight.intensity = 1.2;
    }
    if (this.followPlanet) {
      this._updateFollow();
    } else {
      this._updateFreeCamera(dt);
    }
  }

  _updateFollow() {
    const cam = this.camera;
    const planetPos = new THREE.Vector3();
    this.followPlanet.mesh.getWorldPosition(planetPos);
    // Fixed offset so the camera doesn't orbit with the planet
    const targetPos = planetPos.clone();
    targetPos.y += 5;
    targetPos.z += 12;
    cam.position.lerp(targetPos, 0.03);
    cam.lookAt(planetPos);
  }

  _updateFreeCamera(dt) {
    const cam = this.camera;
    // WASD movement
    const forward = new THREE.Vector3();
    cam.getWorldDirection(forward);
    const right = new THREE.Vector3().crossVectors(forward, cam.up).normalize();
    const speed = this.moveSpeed * dt;
    if (this.keys.w) cam.position.addScaledVector(forward, speed);
    if (this.keys.s) cam.position.addScaledVector(forward, -speed);
    if (this.keys.a) cam.position.addScaledVector(right, -speed);
    if (this.keys.d) cam.position.addScaledVector(right, speed);
    if (this.keys.q) cam.position.y -= speed;
    if (this.keys.e) cam.position.y += speed;
    // Zoom-in animation
    if (this.zoomActive) {
      cam.position.lerp(this.zoomTarget, this.zoomSpeed);
      if (cam.position.distanceTo(this.zoomTarget) < 0.5) {
        this.zoomActive = false;
      }
    }
    // Mouse-driven camera look
    if (this.mouseLookEnabled) {
      cam.rotation.order = "YXZ";
      const sensitivityYaw = 0.24;
      const sensitivityPitch = 0.12;
      const lerpSpeed = 0.12;
      const targetYaw = -this.mouseX * Math.PI * sensitivityYaw;
      const targetPitch = -this.mouseY * Math.PI * sensitivityPitch - 0.15;
      cam.rotation.y += (targetYaw - cam.rotation.y) * lerpSpeed;
      cam.rotation.x += (targetPitch - cam.rotation.x) * lerpSpeed;
    }
  }
}

export default CameraController;
