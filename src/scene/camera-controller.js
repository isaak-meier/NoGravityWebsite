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

/** Seconds for “Enter planet” camera path (ease-in-out along line, look-at center). */
const ENTER_PLANET_DURATION_SEC = 2.35;

const _worldUp = new THREE.Vector3(0, 1, 0);
const _zAxis = new THREE.Vector3(0, 0, 1);
const _worldScaleScratch = new THREE.Vector3();
const _eulerTmp = new THREE.Euler();
const _quatSwipeDelta = new THREE.Quaternion();
const _quatScreen = new THREE.Quaternion();

/**
 * @param {number} t — unit interval [0, 1]
 * @returns {number}
 */
function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
}

function easeOutCubic(t) {
  return 1 - (1 - t) ** 3;
}

/** World units: camera–planet center distance at load; animates down to {@link INTRO_ORBIT_TO_DIST}. */
const INTRO_ORBIT_FROM_DIST = 3000;
/** Target distance from planet center when the intro lerp finishes (HUD “camera distance”). */
const INTRO_ORBIT_TO_DIST = 15;
const INTRO_ORBIT_DURATION_SEC = 5;

function isUiTouchTarget(el) {
  return !!(
    el &&
    el.closest &&
    (el.closest(".bottom-left-hud") ||
      el.closest(".enter-planet-hud") ||
      el.closest(".planet-mailing-panel") ||
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
    /**
     * When set, orbit camera uses the same follow-orbit behavior as a planet, centered on the comet head.
     * @type {null | { getHeadWorldPosition: (v: import('three').Vector3) => import('three').Vector3, getFollowOrbitRadius?: () => number }}
     */
    this.followComet = null;
    /**
     * First planet in {@link setupFollowHandler} — used to re-lock when nothing is followed (no free flight in the main scene).
     * @type {null | { mesh: import('three').Mesh, def?: { radius?: number } }}
     */
    this._fallbackFollowPlanet = null;
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
    /** First planet-follow only: animate orbit radius from {@link INTRO_ORBIT_FROM_DIST} to {@link INTRO_ORBIT_TO_DIST}. */
    this._introOrbitActive = true;
    this._introOrbitElapsed = 0;
    this._lastFollowPlanet = null;
    /**
     * Active “Enter planet” eased move; when finished, orbit follow stays on the planet (no unlock).
     * @type {null | { elapsed: number, duration: number, start: import("three").Vector3, end: import("three").Vector3, center: import("three").Vector3 }}
     */
    this._enterPlanetTween = null;
    /**
     * After “Enter planet” tween completes: keep camera at the eased interior position until the user
     * orbit-drags or wheel-zooms (then we sync orbit distance and resume normal follow).
     */
    this._enterPlanetInteriorHold = false;

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
        if (this._mouseOrbitDragging && (this.followPlanet || this.followComet)) {
        const dx = e.clientX - this._mouseOrbitStart.x;
        const dy = e.clientY - this._mouseOrbitStart.y;
        this._mouseOrbitStart.x = e.clientX;
        this._mouseOrbitStart.y = e.clientY;
        const odx = e.clientX - this._mouseOrbitDownClient.x;
        const ody = e.clientY - this._mouseOrbitDownClient.y;
        if (odx * odx + ody * ody > MOUSE_ORBIT_DRAG_THRESHOLD_PX * MOUSE_ORBIT_DRAG_THRESHOLD_PX) {
          this._suppressNextClickPick = true;
        }
        this._clearEnterPlanetInteriorHold();
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
      if (!this.followPlanet && !this.followComet) return;
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
        this._ensureFollowLocked();
        if (this.followPlanet || this.followComet) {
          this._clearEnterPlanetInteriorHold();
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
        if (this.followComet) {
          this.followComet = null;
          if (this._fallbackFollowPlanet?.mesh) {
            this.followPlanet = this._fallbackFollowPlanet;
          }
          return;
        }
        this.mouseLookEnabled = !this.mouseLookEnabled;
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
        } else if (e.touches.length === 1 && !isUiTouchTarget(e.target)) {
          this._orbitUndecided = true;
          this._orbitStart.x = e.touches[0].clientX;
          this._orbitStart.y = e.touches[0].clientY;
          orbitLast = null;
          this._mobileTouchForward =
            this.isMobile && !this.followPlanet && !this.followComet;
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
        if (e.touches.length !== 1 || pinching) {
          return;
        }
        if (isUiTouchTarget(e.target)) return;
        const t = e.touches[0];
        if (this._orbitUndecided) {
          const odx = t.clientX - this._orbitStart.x;
          const ody = t.clientY - this._orbitStart.y;
          if (odx * odx + ody * ody <= ORBIT_VS_FORWARD_PX * ORBIT_VS_FORWARD_PX) {
            this._mobileTouchForward =
              this.isMobile && !this.followPlanet && !this.followComet;
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

    if (this.followPlanet || this.followComet) {
      this._clearEnterPlanetInteriorHold();
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
   * @param {{ primaryPlanetMesh?: import('three').Object3D, onPrimaryPlanetTap?: () => void, comet?: { group: import('three').Object3D } }} [options]
   */
  setupFollowHandler(renderer, planets, options = {}) {
    const { primaryPlanetMesh, onPrimaryPlanetTap, comet } = options;
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

      const cometHits = comet ? raycaster.intersectObject(comet.group, true) : [];
      const cometHit = cometHits[0];

      let planetPick = null;
      let planetPickDist = Infinity;
      for (const p of planets) {
        const h = raycaster.intersectObject(p.mesh, true);
        if (h.length === 0) continue;
        if (!comet) {
          planetPick = p;
          break;
        }
        if (h[0].distance < planetPickDist) {
          planetPickDist = h[0].distance;
          planetPick = p;
        }
      }

      if (comet && cometHit && (!planetPick || cometHit.distance < planetPickDist)) {
        this._enterPlanetTween = null;
        this.beginFollowComet(comet);
        this.followPlanet = null;
        this.zoomActive = false;
      } else if (planetPick) {
        this._enterPlanetTween = null;
        this.followPlanet = planetPick;
        this.followComet = null;
        this.zoomActive = false;
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
    this._fallbackFollowPlanet = planets[0] ?? null;
  }

  /**
   * If nothing is followed but a fallback planet exists (from {@link setupFollowHandler}), lock onto it.
   */
  _ensureFollowLocked() {
    if (this.followPlanet || this.followComet) return;
    const p = this._fallbackFollowPlanet;
    if (p?.mesh) {
      this.followPlanet = p;
      this.zoomActive = false;
    }
  }

  /**
   * Orbit the comet with the same controls as planet follow (drag, wheel zoom, touch).
   * @param {{ getHeadWorldPosition: (v: THREE.Vector3) => THREE.Vector3, getFollowOrbitRadius?: () => number }} comet
   */
  beginFollowComet(comet) {
    this._enterPlanetTween = null;
    this._enterPlanetInteriorHold = false;
    this._introOrbitActive = false;
    this.followComet = comet;
    this.zoomActive = false;
    this._followOrbitYaw = 0;
    this._followDistanceScale = 1;
    this._followOrbitPitch = this._defaultFollowPitch();
    this.mouseX = 0;
    this.mouseY = 0;
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

  /**
   * Smoothly move the camera into the planet interior (eased); orbit follow remains so the camera stays locked.
   * @param {{ mesh: import("three").Mesh, def?: { radius?: number } }} planet
   */
  animateEnterPlanet(planet) {
    if (!planet?.mesh) return;
    this.followComet = null;
    this.followPlanet = planet;
    this._introOrbitActive = false;
    this._enterPlanetInteriorHold = false;
    this.zoomActive = false;
    planet.mesh.updateWorldMatrix(true, true);
    const center = new THREE.Vector3();
    planet.mesh.getWorldPosition(center);
    const worldR = this._getFollowOrbitTargetWorldRadius();
    const end = new THREE.Vector3().copy(center).add(
      new THREE.Vector3(0, worldR * 0.35, worldR * 0.2)
    );
    this._enterPlanetTween = {
      elapsed: 0,
      duration: ENTER_PLANET_DURATION_SEC,
      start: this.camera.position.clone(),
      end,
      center: center.clone(),
    };
  }

  /**
   * @param {number} dt
   */
  _updateEnterPlanetAnimation(dt) {
    const tw = this._enterPlanetTween;
    if (!tw) return;
    tw.elapsed += dt;
    const u = Math.min(1, tw.elapsed / tw.duration);
    const e = easeInOutCubic(u);
    this.camera.position.lerpVectors(tw.start, tw.end, e);
    this.camera.lookAt(tw.center);
    if (u >= 1) {
      this._enterPlanetTween = null;
      this._enterPlanetInteriorHold = true;
    }
  }

  update(dt) {
    this._ensureFollowLocked();
    if (this.followPlanet !== this._lastFollowPlanet) {
      if (this._lastFollowPlanet && !this.followPlanet) {
        this.mouseX = 0;
        this.mouseY = 0;
        this._swipeQuatOffset.identity();
      }
      this._followOrbitYaw = 0;
      if (this._introOrbitActive) {
        const oy = this.isMobile ? 8 : 5;
        const oz = this.isMobile ? 20 : 12;
        this._followDistanceScale = INTRO_ORBIT_FROM_DIST / Math.hypot(oy, oz);
      } else {
        this._followDistanceScale = 1;
      }
      this._followOrbitPitch = this._defaultFollowPitch();
      if (this._introOrbitActive && this.followPlanet?.mesh && !this.followComet) {
        this._snapCameraToPlanetOrbitDistance(INTRO_ORBIT_FROM_DIST);
      }
      this._enterPlanetInteriorHold = false;
      this._lastFollowPlanet = this.followPlanet;
    }
    if (this.sun) {
      this.sun.scale.setScalar(0.04);
    }
    if (this.sunLight) {
      this.sunLight.intensity = 1.2;
    }
    if (this._enterPlanetTween) {
      this._updateEnterPlanetAnimation(dt);
      return;
    }
    if (this.followPlanet || this.followComet) {
      this._updateFollow(dt);
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
   * World-space radius for min orbit distance: comet head or followed planet.
   * @returns {number}
   */
  _getFollowOrbitTargetWorldRadius() {
    if (this.followComet && typeof this.followComet.getFollowOrbitRadius === "function") {
      return Math.max(0.02, this.followComet.getFollowOrbitRadius());
    }
    const p = this.followPlanet;
    if (!p?.mesh) return 1;
    p.mesh.getWorldScale(_worldScaleScratch);
    const m = Math.max(_worldScaleScratch.x, _worldScaleScratch.y, _worldScaleScratch.z);
    const base = p.def?.radius ?? 0.9;
    return base * m;
  }

  /**
   * Minimum `_followDistanceScale` so orbit distance ≥ target radius + margin.
   * @returns {number}
   */
  _minFollowOrbitDistanceScale() {
    const offsetY = this.isMobile ? 8 : 5;
    const offsetZ = this.isMobile ? 20 : 12;
    const baseR = Math.hypot(offsetY, offsetZ);
    const worldR = this._getFollowOrbitTargetWorldRadius();
    return (worldR + FOLLOW_ORBIT_SURFACE_MARGIN) / baseR;
  }

  /**
   * Place the camera on the follow orbit shell at the given world-space distance from the planet center.
   * Used on intro lock so we do not lerp from the scene’s close default camera position to the far intro shell (visible “zoom out”).
   * @param {number} worldDistance
   */
  _snapCameraToPlanetOrbitDistance(worldDistance) {
    if (!this.followPlanet?.mesh || this.followComet) return;
    const cam = this.camera;
    const orbitCenter = new THREE.Vector3();
    this.followPlanet.mesh.getWorldPosition(orbitCenter);
    const phi = THREE.MathUtils.clamp(
      this._followOrbitPitch,
      FOLLOW_ORBIT_PITCH_MIN,
      FOLLOW_ORBIT_PITCH_MAX
    );
    const theta = this._followOrbitYaw;
    const sinP = Math.sin(phi);
    const r = worldDistance;
    const offset = new THREE.Vector3(
      r * sinP * Math.sin(theta),
      r * Math.cos(phi),
      r * sinP * Math.cos(theta)
    );
    cam.position.copy(orbitCenter).add(offset);
    cam.lookAt(orbitCenter);
  }

  /** Sets `_followDistanceScale` from current camera distance to the active follow target (planet or comet). */
  _syncFollowOrbitScaleFromCameraPosition() {
    const orbitCenter = new THREE.Vector3();
    if (this.followComet) {
      this.followComet.getHeadWorldPosition(orbitCenter);
    } else if (this.followPlanet?.mesh) {
      this.followPlanet.mesh.getWorldPosition(orbitCenter);
    } else {
      return;
    }
    const offsetY = this.isMobile ? 8 : 5;
    const offsetZ = this.isMobile ? 20 : 12;
    const baseR = Math.hypot(offsetY, offsetZ);
    const dist = this.camera.position.distanceTo(orbitCenter);
    const minScale = this._minFollowOrbitDistanceScale();
    this._followDistanceScale = THREE.MathUtils.clamp(
      dist / baseR,
      Math.max(FOLLOW_ORBIT_ZOOM_MIN, minScale),
      FOLLOW_ORBIT_ZOOM_MAX
    );
  }

  _clearEnterPlanetInteriorHold() {
    if (!this._enterPlanetInteriorHold) return;
    this._enterPlanetInteriorHold = false;
    this._syncFollowOrbitScaleFromCameraPosition();
  }

  _updateFollow(dt) {
    const cam = this.camera;
    const orbitCenter = new THREE.Vector3();
    if (this.followComet) {
      this.followComet.getHeadWorldPosition(orbitCenter);
    } else if (this.followPlanet?.mesh) {
      this.followPlanet.mesh.getWorldPosition(orbitCenter);
    } else {
      return;
    }
    if (this._enterPlanetInteriorHold) {
      cam.lookAt(orbitCenter);
      return;
    }
    const offsetY = this.isMobile ? 8 : 5;
    const offsetZ = this.isMobile ? 20 : 12;
    const baseR = Math.hypot(offsetY, offsetZ);
    const minScale = this._minFollowOrbitDistanceScale();
    if (this._introOrbitActive && this.followPlanet && !this.followComet) {
      this._introOrbitElapsed += dt;
      const u = Math.min(1, this._introOrbitElapsed / INTRO_ORBIT_DURATION_SEC);
      const dist = THREE.MathUtils.lerp(
        INTRO_ORBIT_FROM_DIST,
        INTRO_ORBIT_TO_DIST,
        easeOutCubic(u)
      );
      this._followDistanceScale = Math.max(dist / baseR, minScale);
      if (u >= 1) {
        this._introOrbitActive = false;
      }
    } else {
      this._followDistanceScale = Math.max(this._followDistanceScale, minScale);
    }
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
    const ideal = orbitCenter.clone().add(offset);
    const lerpT =
      this._introOrbitActive && this.followPlanet && !this.followComet
        ? 0.085
        : this.isMobile
          ? 0.055
          : 0.02;
    cam.position.lerp(ideal, lerpT);
    cam.lookAt(orbitCenter);
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

    if (this.mouseLookEnabled && !this.isMobile) {
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
