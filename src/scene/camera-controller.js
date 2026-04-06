import * as THREE from "three";

/** Pixels of single-finger movement before we treat touchend as a drag, not a tap. */
const TOUCH_TAP_MOVE_THRESHOLD_PX = 22;

/** Desktop: mouse movement past this while button down counts as orbit drag, not a pick click. */
const MOUSE_ORBIT_DRAG_THRESHOLD_PX = 5;

/** Movement past this (from touch origin) starts orbit drag; below = tap-and-hold forward (free cam only). */
const ORBIT_VS_FORWARD_PX = 10;

/** Pinch: field-of-view change per pixel of finger separation change (zoom in / out). */
const PINCH_FOV_PER_PX = 0.065;

/** Wheel: multiplicative zoom step per unit deltaY when orbiting a planet (locked). */
const FOLLOW_ORBIT_ZOOM_SENSITIVITY = 0.00115;
/** Wide finite bounds so zoom feels unlimited without NaN/Infinity from floats. */
const FOLLOW_ORBIT_ZOOM_MIN = 1e-18;
const FOLLOW_ORBIT_ZOOM_MAX = 1e24;

/**
 * World units: added to planet world radius for min orbit distance.
 * Slightly negative = allow zooming a little inside the shell before hard stop.
 */
const FOLLOW_ORBIT_SURFACE_MARGIN = -0.09;

/** Degrees of yaw/pitch per full-width (or full-height) touch drag — kept low to reduce motion discomfort. */
const SWIPE_DEGREES_PER_FULL_DRAG = 18;
const SWIPE_TURN_FRACTION = SWIPE_DEGREES_PER_FULL_DRAG / 360;

/** Yaw per full horizontal drag when orbiting a locked planet (mouse + touch). */
const FOLLOW_ORBIT_DRAG_DEGREES_PER_FULL_DRAG = 56;
const FOLLOW_ORBIT_DRAG_TURN_FRACTION = FOLLOW_ORBIT_DRAG_DEGREES_PER_FULL_DRAG / 360;

/** Polar angle from +Y (0 = above planet); clamped so orbit stays usable. */
const FOLLOW_ORBIT_PITCH_MIN = 0.12;
const FOLLOW_ORBIT_PITCH_MAX = Math.PI - 0.12;

const _worldUp = new THREE.Vector3(0, 1, 0);
const _zAxis = new THREE.Vector3(0, 0, 1);
const _worldScaleScratch = new THREE.Vector3();
const _eulerTmp = new THREE.Euler();
const _quatSwipeDelta = new THREE.Quaternion();
const _quatScreen = new THREE.Quaternion();

function isUiTouchTarget(el) {
  return !!(
    el &&
    el.closest &&
    (el.closest(".bottom-left-hud") ||
      el.closest(".screen-dials") ||
      el.closest(".lil-gui"))
  );
}

/**
 * @param {number} alphaDeg
 * @param {number} betaDeg
 * @param {number} gammaDeg
 * @param {number} screenAngleDeg
 */
function quaternionFromDeviceOrientation(alphaDeg, betaDeg, gammaDeg, screenAngleDeg, target) {
  const a = THREE.MathUtils.degToRad(alphaDeg);
  const b = THREE.MathUtils.degToRad(betaDeg);
  const g = THREE.MathUtils.degToRad(gammaDeg);
  const o = THREE.MathUtils.degToRad(screenAngleDeg);
  _eulerTmp.set(b, a, -g, "YXZ");
  target.setFromEuler(_eulerTmp);
  _quatScreen.setFromAxisAngle(_zAxis, -o);
  target.multiply(_quatScreen);
}

class CameraController {
  constructor(container, camera, { isMobile = false } = {}) {
    this.camera = camera;
    this.container = container;
    this.isMobile = isMobile;
    this.mouseX = 0;
    this.mouseY = 0;
    this.keys = { w: false, a: false, s: false, d: false, q: false, e: false };
    this.moveSpeed = 14;
    this.startDistance = 300;
    this.zoomTarget = new THREE.Vector3(0, 5, 25);
    this.zoomActive = true;
    this.zoomSpeed = 0.012;
    this.followPlanet = null;
    /** When true, free-roam camera; when false, orbit the current `followPlanet` if set. */
    this.explorerMode = false;
    /** Optional home planet when re-locking after explore with no current follow target. */
    this.defaultFollowPlanet = null;
    this.mouseLookEnabled = true;
    this.sun = null;
    this.sunLight = null;
    /** True if current gesture used two fingers (pinch) — suppress next tap pick. */
    this._multiTouchGesture = false;
    /** Yaw orbit around follow target (world Y), radians. */
    this._followOrbitYaw = 0;
    /** Polar angle from +Y axis (radians); 0 = above, π/2 ≈ equator, π = below. */
    this._followOrbitPitch = Math.atan2(12, 5);
    /** Scales orbit offset from planet when wheel-zooming in locked mode. */
    this._followDistanceScale = 1;
    this._lastFollowPlanet = null;

    /** Mobile: one-finger touch still undecided between forward-hold vs orbit. */
    this._orbitUndecided = false;
    this._orbitStart = { x: 0, y: 0 };
    /** Suppress planet pick on click after a desktop orbit drag. */
    this._suppressNextClickPick = false;
    /** Desktop: true while primary button held for orbit-drag around followed planet. */
    this._mouseOrbitDragging = false;
    this._mouseOrbitStart = { x: 0, y: 0 };
    this._mouseOrbitDownClient = { x: 0, y: 0 };
    /** Mobile: true while finger down, movement small, not following — fly forward. */
    this._mobileTouchForward = false;
    /** Accumulated swipe rotation when using device orientation + touch (free cam). */
    this._swipeQuatOffset = new THREE.Quaternion();
    /** Device orientation quaternion (mobile). */
    this._deviceQuat = new THREE.Quaternion();
    this._deviceOrientationListening = false;
    this._deviceOrientationRequested = false;
    this._hasDeviceOrientationSample = false;

    this._onDeviceOrientation = (e) => this._handleDeviceOrientation(e);
    this._attach(container);
  }

  _attach(container) {
    container.addEventListener("mousemove", (e) => {
      if (this.isMobile) return;
      if (this._mouseOrbitDragging && this.followPlanet && !this.explorerMode) {
        const dx = e.clientX - this._mouseOrbitStart.x;
        const dy = e.clientY - this._mouseOrbitStart.y;
        this._mouseOrbitStart.x = e.clientX;
        this._mouseOrbitStart.y = e.clientY;
        const odx = e.clientX - this._mouseOrbitDownClient.x;
        const ody = e.clientY - this._mouseOrbitDownClient.y;
        if (odx * odx + ody * ody > MOUSE_ORBIT_DRAG_THRESHOLD_PX * MOUSE_ORBIT_DRAG_THRESHOLD_PX) {
          this._suppressNextClickPick = true;
        }
        const w = Math.max(container.clientWidth, 1);
        const h = Math.max(container.clientHeight, 1);
        const fullTurn = Math.PI * 2 * FOLLOW_ORBIT_DRAG_TURN_FRACTION;
        const yawRad = (dx / w) * fullTurn;
        const pitchRad = (dy / h) * fullTurn;
        this._followOrbitYaw -= yawRad;
        this._followOrbitPitch -= pitchRad;
        this._followOrbitPitch = THREE.MathUtils.clamp(
          this._followOrbitPitch,
          FOLLOW_ORBIT_PITCH_MIN,
          FOLLOW_ORBIT_PITCH_MAX
        );
        return;
      }
      const rect = container.getBoundingClientRect();
      this.mouseX = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      this.mouseY = ((e.clientY - rect.top) / rect.height) * 2 - 1;
    });
    container.addEventListener("mousedown", (e) => {
      if (this.isMobile || e.button !== 0) return;
      if (isUiTouchTarget(e.target)) return;
      if (!this.followPlanet || this.explorerMode) return;
      this._mouseOrbitDragging = true;
      this._mouseOrbitStart.x = e.clientX;
      this._mouseOrbitStart.y = e.clientY;
      this._mouseOrbitDownClient.x = e.clientX;
      this._mouseOrbitDownClient.y = e.clientY;
    });
    const endMouseOrbit = () => {
      this._mouseOrbitDragging = false;
    };
    container.addEventListener("mouseup", endMouseOrbit);
    container.addEventListener("mouseleave", endMouseOrbit);
    container.addEventListener("contextmenu", (e) => e.preventDefault());
    window.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        if (!this.explorerMode && this.followPlanet) {
          const factor = Math.exp(e.deltaY * FOLLOW_ORBIT_ZOOM_SENSITIVITY);
          const minBySurface = this._minFollowOrbitDistanceScale();
          this._followDistanceScale = THREE.MathUtils.clamp(
            this._followDistanceScale * factor,
            Math.max(FOLLOW_ORBIT_ZOOM_MIN, minBySurface),
            FOLLOW_ORBIT_ZOOM_MAX
          );
          return;
        }
        const dir = new THREE.Vector3();
        this.camera.getWorldDirection(dir);
        const amt = -e.deltaY * 0.025;
        this.camera.position.addScaledVector(dir, amt);
      },
      { passive: false }
    );
    window.addEventListener("keydown", (e) => {
      const k = e.key.toLowerCase();
      if (k in this.keys) this.keys[k] = true;
      if (e.key === "Escape") {
        if (this.explorerMode) {
          this.explorerMode = false;
          if (!this.followPlanet && this.defaultFollowPlanet) {
            this.followPlanet = this.defaultFollowPlanet;
          }
        } else {
          this.mouseLookEnabled = !this.mouseLookEnabled;
        }
      }
    });
    window.addEventListener("keyup", (e) => {
      const k = e.key.toLowerCase();
      if (k in this.keys) this.keys[k] = false;
    });
    this._attachTouch(container);
    if (this.isMobile) {
      this._requestDeviceOrientationWhenReady();
    }
  }

  _requestDeviceOrientationWhenReady() {
    const tryListen = () => {
      if (this._deviceOrientationListening || this._deviceOrientationRequested) return;
      this._deviceOrientationRequested = true;
      if (typeof DeviceOrientationEvent === "undefined") return;
      const go = () => {
        if (this._deviceOrientationListening) return;
        window.addEventListener("deviceorientation", this._onDeviceOrientation, true);
        this._deviceOrientationListening = true;
      };
      if (typeof DeviceOrientationEvent.requestPermission === "function") {
        DeviceOrientationEvent.requestPermission()
          .then((r) => {
            if (r === "granted") go();
          })
          .catch(() => {});
      } else {
        go();
      }
    };
    this.container.addEventListener("touchstart", tryListen, { passive: true, once: true });
    this.container.addEventListener("click", tryListen, { passive: true, once: true });
  }

  _handleDeviceOrientation(e) {
    if (e.alpha == null || e.beta == null || e.gamma == null) return;
    const angle =
      typeof screen !== "undefined" && screen.orientation && screen.orientation.angle != null
        ? screen.orientation.angle
        : typeof window.orientation !== "undefined"
          ? window.orientation
          : 0;
    quaternionFromDeviceOrientation(e.alpha, e.beta, e.gamma, angle, this._deviceQuat);
    this._hasDeviceOrientationSample = true;
  }

  _attachTouch(container) {
    let pinching = false;
    let lastPinchDist = 0;
    /** @type {{ x: number, y: number } | null} */
    let orbitLast = null;

    container.addEventListener(
      "touchstart",
      (e) => {
        if (e.touches.length === 2) {
          this._multiTouchGesture = true;
          pinching = true;
          orbitLast = null;
          this._orbitUndecided = false;
          this._mobileTouchForward = false;
          const dx = e.touches[0].clientX - e.touches[1].clientX;
          const dy = e.touches[0].clientY - e.touches[1].clientY;
          lastPinchDist = Math.hypot(dx, dy);
          e.preventDefault();
        } else if (
          this.isMobile &&
          e.touches.length === 1 &&
          !isUiTouchTarget(e.target)
        ) {
          this._orbitUndecided = true;
          this._orbitStart.x = e.touches[0].clientX;
          this._orbitStart.y = e.touches[0].clientY;
          orbitLast = null;
          this._mobileTouchForward = !this.followPlanet;
        }
      },
      { passive: false }
    );

    container.addEventListener(
      "touchmove",
      (e) => {
        if (pinching && e.touches.length === 2) {
          const dx = e.touches[0].clientX - e.touches[1].clientX;
          const dy = e.touches[0].clientY - e.touches[1].clientY;
          const dist = Math.hypot(dx, dy);
          const delta = dist - lastPinchDist;
          lastPinchDist = dist;
          const cam = this.camera;
          if (cam.isPerspectiveCamera) {
            cam.fov = THREE.MathUtils.clamp(
              cam.fov - delta * PINCH_FOV_PER_PX,
              22,
              95
            );
            cam.updateProjectionMatrix();
          }
          e.preventDefault();
          return;
        }
        if (
          !this.isMobile ||
          e.touches.length !== 1 ||
          pinching
        ) {
          return;
        }
        if (isUiTouchTarget(e.target)) return;
        const t = e.touches[0];
        if (this._orbitUndecided) {
          const odx = t.clientX - this._orbitStart.x;
          const ody = t.clientY - this._orbitStart.y;
          if (odx * odx + ody * ody <= ORBIT_VS_FORWARD_PX * ORBIT_VS_FORWARD_PX) {
            this._mobileTouchForward = !this.followPlanet;
            return;
          }
          this._orbitUndecided = false;
          this._mobileTouchForward = false;
          orbitLast = { x: this._orbitStart.x, y: this._orbitStart.y };
        }
        if (!orbitLast) return;
        const dx = t.clientX - orbitLast.x;
        const dy = t.clientY - orbitLast.y;
        orbitLast = { x: t.clientX, y: t.clientY };
        this._applyTouchOrbit(dx, dy, container);
        e.preventDefault();
      },
      { passive: false }
    );

    container.addEventListener("touchend", (e) => {
      if (e.touches.length < 2) {
        pinching = false;
      }
      if (e.touches.length === 0) {
        orbitLast = null;
        this._orbitUndecided = false;
        this._mobileTouchForward = false;
      }
    });
  }

  /**
   * Linear mapping: drag across full viewport width (or height) ⇒ SWIPE_TURN_FRACTION * 2π rad
   * in that axis (see SWIPE_DEGREES_PER_FULL_DRAG). Planet follow uses FOLLOW_ORBIT_DRAG_*.
   */
  _applyTouchOrbit(dx, dy, container) {
    const w = Math.max(container.clientWidth, 1);
    const h = Math.max(container.clientHeight, 1);
    const cam = this.camera;

    if (this.followPlanet) {
      const fullTurnFollow = Math.PI * 2 * FOLLOW_ORBIT_DRAG_TURN_FRACTION;
      const yawRadFollow = (dx / w) * fullTurnFollow;
      const pitchRadFollow = (dy / h) * fullTurnFollow;
      this._followOrbitYaw -= yawRadFollow;
      this._followOrbitPitch -= pitchRadFollow;
      this._followOrbitPitch = THREE.MathUtils.clamp(
        this._followOrbitPitch,
        FOLLOW_ORBIT_PITCH_MIN,
        FOLLOW_ORBIT_PITCH_MAX
      );
      return;
    }

    const fullTurn = Math.PI * 2 * SWIPE_TURN_FRACTION;
    const yawRad = (dx / w) * fullTurn;
    const pitchRad = (dy / h) * fullTurn;

    if (this.isMobile && this._deviceOrientationListening && this._hasDeviceOrientationSample) {
      _eulerTmp.set(-pitchRad, -yawRad, 0, "YXZ");
      _quatSwipeDelta.setFromEuler(_eulerTmp);
      this._swipeQuatOffset.premultiply(_quatSwipeDelta);
      return;
    }

    cam.rotation.order = "YXZ";
    cam.rotation.y -= yawRad;
    cam.rotation.x -= pitchRad;
    const lim = Math.PI / 2 - 0.05;
    cam.rotation.x = Math.max(-lim, Math.min(lim, cam.rotation.x));
  }

  /**
   * @param {import('three').WebGLRenderer} renderer
   * @param {Array<{ mesh: import('three').Mesh, def: { radius: number } }>} planets
   * @param {{ primaryPlanetMesh?: import('three').Object3D, onPrimaryPlanetTap?: () => void }} [options]
   */
  setupFollowHandler(renderer, planets, options = {}) {
    const { primaryPlanetMesh, onPrimaryPlanetTap } = options;
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    const dom = renderer.domElement;

    let tapStartX = 0;
    let tapStartY = 0;
    let tapMoved = false;

    dom.addEventListener(
      "touchstart",
      (e) => {
        if (e.touches.length === 1) {
          tapStartX = e.touches[0].clientX;
          tapStartY = e.touches[0].clientY;
          tapMoved = false;
        }
      },
      { passive: true }
    );

    dom.addEventListener(
      "touchmove",
      (e) => {
        if (e.touches.length !== 1) return;
        const t = e.touches[0];
        const dx = t.clientX - tapStartX;
        const dy = t.clientY - tapStartY;
        if (dx * dx + dy * dy > TOUCH_TAP_MOVE_THRESHOLD_PX * TOUCH_TAP_MOVE_THRESHOLD_PX) {
          tapMoved = true;
        }
      },
      { passive: true }
    );

    const runPick = (clientX, clientY) => {
      const rect = dom.getBoundingClientRect();
      pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, this.camera);

      if (this._suppressNextClickPick) {
        this._suppressNextClickPick = false;
        return;
      }

      if (primaryPlanetMesh && onPrimaryPlanetTap) {
        const surfaceHits = raycaster.intersectObject(primaryPlanetMesh, true);
        if (surfaceHits.length > 0) {
          onPrimaryPlanetTap();
        }
      }

      let hitPlanet = null;
      for (const p of planets) {
        const h = raycaster.intersectObject(p.mesh, true);
        if (h.length > 0) {
          hitPlanet = p;
          break;
        }
      }

      if (hitPlanet) {
        this.followPlanet = hitPlanet;
        this.zoomActive = false;
      } else if (this.explorerMode) {
        this.followPlanet = null;
      }
    };

    dom.addEventListener("click", (e) => {
      runPick(e.clientX, e.clientY);
    });

    dom.addEventListener(
      "touchend",
      (e) => {
        if (e.touches.length > 0) return;
        if (this._multiTouchGesture) {
          this._multiTouchGesture = false;
          return;
        }
        if (e.changedTouches.length !== 1) return;
        if (tapMoved) return;
        const t = e.changedTouches[0];
        runPick(t.clientX, t.clientY);
      },
      { passive: true }
    );
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
    if (this.followPlanet !== this._lastFollowPlanet) {
      if (this._lastFollowPlanet && !this.followPlanet) {
        this.mouseX = 0;
        this.mouseY = 0;
        this._swipeQuatOffset.identity();
      }
      this._followOrbitYaw = 0;
      this._followDistanceScale = 1;
      this._followOrbitPitch = this._defaultFollowPitch();
      this._lastFollowPlanet = this.followPlanet;
    }
    if (this.sun) {
      this.sun.scale.setScalar(0.04);
    }
    if (this.sunLight) {
      this.sunLight.intensity = 1.2;
    }
    if (!this.explorerMode && this.followPlanet) {
      this._updateFollow();
    } else {
      this._updateFreeCamera(dt);
    }
  }

  /**
   * Default polar angle matching the legacy (offsetY, offsetZ) orbit in the XZ meridian.
   * @returns {number}
   */
  _defaultFollowPitch() {
    const offsetY = this.isMobile ? 8 : 5;
    const offsetZ = this.isMobile ? 20 : 12;
    return Math.atan2(offsetZ, offsetY);
  }

  /**
   * World-space radius of the followed planet mesh (def.radius × max world scale).
   * @returns {number}
   */
  _getFollowPlanetWorldRadius() {
    const p = this.followPlanet;
    if (!p?.mesh) return 1;
    p.mesh.getWorldScale(_worldScaleScratch);
    const m = Math.max(_worldScaleScratch.x, _worldScaleScratch.y, _worldScaleScratch.z);
    const base = p.def?.radius ?? 0.9;
    return base * m;
  }

  /**
   * Minimum `_followDistanceScale` so orbit distance ≥ planet radius + margin.
   * @returns {number}
   */
  _minFollowOrbitDistanceScale() {
    const offsetY = this.isMobile ? 8 : 5;
    const offsetZ = this.isMobile ? 20 : 12;
    const baseR = Math.hypot(offsetY, offsetZ);
    const worldR = this._getFollowPlanetWorldRadius();
    return (worldR + FOLLOW_ORBIT_SURFACE_MARGIN) / baseR;
  }

  _updateFollow() {
    const cam = this.camera;
    const planetPos = new THREE.Vector3();
    this.followPlanet.mesh.getWorldPosition(planetPos);
    const offsetY = this.isMobile ? 8 : 5;
    const offsetZ = this.isMobile ? 20 : 12;
    const baseR = Math.hypot(offsetY, offsetZ);
    const minScale = this._minFollowOrbitDistanceScale();
    this._followDistanceScale = Math.max(this._followDistanceScale, minScale);
    const r = baseR * this._followDistanceScale;
    const phi = THREE.MathUtils.clamp(
      this._followOrbitPitch,
      FOLLOW_ORBIT_PITCH_MIN,
      FOLLOW_ORBIT_PITCH_MAX
    );
    const theta = this._followOrbitYaw;
    const sinP = Math.sin(phi);
    const offset = new THREE.Vector3(
      r * sinP * Math.sin(theta),
      r * Math.cos(phi),
      r * sinP * Math.cos(theta)
    );
    const ideal = planetPos.clone().add(offset);
    const lerpT = this.isMobile ? 0.055 : 0.02;
    cam.position.lerp(ideal, lerpT);
    cam.lookAt(planetPos);
  }

  _updateFreeCamera(dt) {
    const cam = this.camera;
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

    if (this.isMobile && this._mobileTouchForward) {
      cam.position.addScaledVector(forward, speed);
    }

    if (this.zoomActive) {
      cam.position.lerp(this.zoomTarget, this.zoomSpeed);
      if (cam.position.distanceTo(this.zoomTarget) < 0.5) {
        this.zoomActive = false;
      }
    }

    if (this.isMobile && this._deviceOrientationListening && this._hasDeviceOrientationSample) {
      cam.quaternion.copy(this._deviceQuat);
      cam.quaternion.multiply(this._swipeQuatOffset);
      return;
    }

    if (this.explorerMode && this.mouseLookEnabled && !this.isMobile) {
      cam.rotation.order = "YXZ";
      const panSpeed = 0.42;
      const deadzone = 0.2;
      const applyDeadzone = (v) =>
        Math.abs(v) < deadzone ? 0 : (v - Math.sign(v) * deadzone) / (1 - deadzone);
      cam.rotation.y -= applyDeadzone(this.mouseX) * panSpeed * dt;
      cam.rotation.x -= applyDeadzone(this.mouseY) * panSpeed * dt;
    }
  }
}

export default CameraController;
