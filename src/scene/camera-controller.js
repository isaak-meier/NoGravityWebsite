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
const FOLLOW_ORBIT_DRAG_DEGREES_PER_FULL_DRAG = 90;
const FOLLOW_ORBIT_DRAG_TURN_FRACTION = FOLLOW_ORBIT_DRAG_DEGREES_PER_FULL_DRAG / 360;

/**
 * Yaw per full horizontal drag in graph (constellation) view. Higher than the follow value because
 * the camera sits far from the orbit pivot, so the same pixel→radian feel reads as sluggish.
 */
const GRAPH_ORBIT_DRAG_DEGREES_PER_FULL_DRAG = 240;
const GRAPH_ORBIT_DRAG_TURN_FRACTION = GRAPH_ORBIT_DRAG_DEGREES_PER_FULL_DRAG / 360;

/** Seconds for “Enter planet” camera path (ease-in-out along line, look-at center). */
const ENTER_PLANET_DURATION_SEC = 2.35;

/** World-space orbit distance from a followed planet beyond which we flip into graph (constellation) view. */
const GRAPH_MODE_DISTANCE_THRESHOLD = 5000;
/** Hysteresis for exiting graph-on-zoom-in: must zoom in past 0.9× threshold to flip back to follow. */
const GRAPH_MODE_HYSTERESIS = 0.9;
/** Default radius of the graph-view orbit around the constellation centroid (world units). */
const GRAPH_ORBIT_DEFAULT_DISTANCE = 17000;
/** Min/max graph-orbit distance (wheel zoom clamp). Min < threshold so wheel-in transitions cleanly. */
const GRAPH_ORBIT_DISTANCE_MIN = GRAPH_MODE_DISTANCE_THRESHOLD * 0.85;
const GRAPH_ORBIT_DISTANCE_MAX = 120000;
/** Wheel: multiplicative zoom step per unit deltaY in graph view (matches feel of follow zoom). */
const GRAPH_ORBIT_ZOOM_SENSITIVITY = 0.00115;
/** Seconds for click-to-zoom-in tween from graph view back to a planet's follow shell. */
const GRAPH_ZOOM_TWEEN_DURATION_SEC = 1.6;

/**
 * Camera local +Y projected onto world +Y above this ⇒ no roll stabilization (pure orbit quaternion).
 * Below {@link ORBIT_ROLL_BLEND_TO_CAM_UP_Y}, blend fully toward a world-up `lookAt` from eye→pivot.
 */
const ORBIT_ROLL_BLEND_FROM_CAM_UP_Y = 0.42;
const ORBIT_ROLL_BLEND_TO_CAM_UP_Y = -0.22;
/** If |look-axis·worldY| exceeds this, skip upright look-at (near singularity over / under the pivot). */
const ORBIT_ROLL_LOOKAT_SKIP_AXIS_Y = 0.986;

const _worldUp = new THREE.Vector3(0, 1, 0);
const _worldRight = new THREE.Vector3(1, 0, 0);
const _zAxis = new THREE.Vector3(0, 0, 1);
const _qPitchScratch = new THREE.Quaternion();
const _qYawScratch = new THREE.Quaternion();
const _qOrbitScratch = new THREE.Quaternion();
const _worldScaleScratch = new THREE.Vector3();
const _exitSnapshotInvMat = new THREE.Matrix4();
const _exitSnapshotOffset = new THREE.Vector3();
const _exitSnapshotMeshQ = new THREE.Quaternion();
const _exitSnapshotCamQ = new THREE.Quaternion();
const _eulerTmp = new THREE.Euler();
const _quatSwipeDelta = new THREE.Quaternion();
const _quatScreen = new THREE.Quaternion();
const _qUprightLookScratch = new THREE.Quaternion();
const _qRollStabilizedScratch = new THREE.Quaternion();
const _fwdAxisScratch = new THREE.Vector3();
const _camUpAxisScratch = new THREE.Vector3();
/** Scratch camera used only to match {@link THREE.PerspectiveCamera.prototype.lookAt} roll convention. */
const _orbitLookCam = new THREE.PerspectiveCamera(45, 1, 0.1, 1e6);
const _orbitPivotForDrag = new THREE.Vector3();
const _uDirDrag = new THREE.Vector3();
const _scrRightDrag = new THREE.Vector3();
const _scrUpDrag = new THREE.Vector3();
const _tRDrag = new THREE.Vector3();
const _tUDrag = new THREE.Vector3();

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
      el.closest(".planet-interior-hud") ||
      el.closest(".screen-dials") ||
      el.closest(".lil-gui"))
  );
}

/** True when R / orbit recovery should not steal focus from text fields or lil-gui. */
function isOrbitKeyBlockedTarget(el) {
  if (!el) return false;
  const tag = el.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (el.isContentEditable) return true;
  return !!(el.closest && el.closest(".lil-gui"));
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
    /**
     * Pose relative to the planet mesh at “Enter planet” click — used by {@link animateExitPlanet}.
     * @type {null | { planet: { mesh: import("three").Mesh }, localPos: import("three").Vector3, relQuat: import("three").Quaternion }}
     */
    this._planetInteriorExitSnapshot = null;

    /**
     * Planet-graph (constellation) view state. Active when wheel-zoomed past
     * {@link GRAPH_MODE_DISTANCE_THRESHOLD}; camera orbits the planet centroid instead of any
     * single planet, and clicks raycast against {@link graphPickProxies}.
     */
    this._graphMode = false;
    this._graphOrbitYaw = 0;
    this._graphOrbitPitch = Math.PI / 2;
    this._graphOrbitDistance = GRAPH_ORBIT_DEFAULT_DISTANCE;
    /** Centroid of all planet positions (world space). Set by the host scene via assignment. */
    this.graphCentroid = new THREE.Vector3(0, 0, 0);
    /** Invisible click targets (one per planet) used in graph view. Set by the host scene. */
    this.graphPickProxies = [];
    /** The planet we were following before entering graph mode — restored on zoom-in if no click. */
    this._lastFollowedPlanetForGraph = null;

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
    const endMouseOrbit = () => {
      this._mouseOrbitDragging = false;
    };
    /** Primary button released globally (canvas drag often ends outside #three-container). */
    const onDocumentMouseUp = (e) => {
      if (e.button === 0) endMouseOrbit();
    };
    document.addEventListener("mouseup", onDocumentMouseUp, true);

    const beginMouseOrbitIfEligible = (/** @type {MouseEvent} */ e) => {
      if (this.isMobile || e.button !== 0) return;
      const t = /** @type {Node | null} */ (e.target);
      if (!t || !container.contains(t)) return;
      if (isUiTouchTarget(/** @type {HTMLElement} */ (t))) return;
      if (!this.followPlanet && !this.followComet && !this._graphMode) return;
      this._mouseOrbitDragging = true;
      this._mouseOrbitStart.x = e.clientX;
      this._mouseOrbitStart.y = e.clientY;
      this._mouseOrbitDownClient.x = e.clientX;
      this._mouseOrbitDownClient.y = e.clientY;
    };
    window.addEventListener("mousedown", beginMouseOrbitIfEligible, true);

    container.addEventListener("mousemove", (e) => {
      if (this.isMobile) return;
      if (this._mouseOrbitDragging && (this.followPlanet || this.followComet || this._graphMode)) {
        const dx = e.clientX - this._mouseOrbitStart.x;
        const dy = e.clientY - this._mouseOrbitStart.y;
        this._mouseOrbitStart.x = e.clientX;
        this._mouseOrbitStart.y = e.clientY;
        const odx = e.clientX - this._mouseOrbitDownClient.x;
        const ody = e.clientY - this._mouseOrbitDownClient.y;
        if (odx * odx + ody * ody > MOUSE_ORBIT_DRAG_THRESHOLD_PX * MOUSE_ORBIT_DRAG_THRESHOLD_PX) {
          this._suppressNextClickPick = true;
        }
        if (!this._graphMode) this._clearEnterPlanetInteriorHold();
        this._applyScreenSpaceOrbitDrag(dx, dy, container);
        return;
      }
      const rect = container.getBoundingClientRect();
      this.mouseX = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      this.mouseY = ((e.clientY - rect.top) / rect.height) * 2 - 1;
    });
    container.addEventListener("mouseup", endMouseOrbit);
    container.addEventListener("contextmenu", (e) => e.preventDefault());
    window.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        this._ensureFollowLocked();
        if (this._graphMode) {
          const factor = Math.exp(e.deltaY * GRAPH_ORBIT_ZOOM_SENSITIVITY);
          this._graphOrbitDistance = THREE.MathUtils.clamp(
            this._graphOrbitDistance * factor,
            GRAPH_ORBIT_DISTANCE_MIN,
            GRAPH_ORBIT_DISTANCE_MAX
          );
          if (this._graphOrbitDistance < GRAPH_MODE_DISTANCE_THRESHOLD * GRAPH_MODE_HYSTERESIS) {
            this._exitGraphModeToFollow();
          }
          return;
        }
        if (this.followPlanet || this.followComet) {
          this._clearEnterPlanetInteriorHold();
          const factor = Math.exp(e.deltaY * FOLLOW_ORBIT_ZOOM_SENSITIVITY);
          const minBySurface = this._minFollowOrbitDistanceScale();
          this._followDistanceScale = THREE.MathUtils.clamp(
            this._followDistanceScale * factor,
            Math.max(FOLLOW_ORBIT_ZOOM_MIN, minBySurface),
            FOLLOW_ORBIT_ZOOM_MAX
          );
          if (this._currentFollowOrbitDistance() >= GRAPH_MODE_DISTANCE_THRESHOLD) {
            this._enterGraphMode();
          }
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
      if (e.code === "KeyR" && !e.ctrlKey && !e.metaKey && !e.altKey) {
        if (!isOrbitKeyBlockedTarget(/** @type {HTMLElement} */ (e.target))) {
          this._recoverLevelOrbitView();
        }
        return;
      }
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
   * World-space pivot for follow / graph orbit drag (planet center, comet head, or graph centroid).
   * @param {import("three").Vector3} out
   */
  _fillOrbitPivotForDrag(out) {
    if (this._graphMode) {
      const t = this._lastFollowedPlanetForGraph;
      if (t?.mesh) {
        t.mesh.getWorldPosition(out);
        return;
      }
      if (this.graphCentroid) {
        out.copy(this.graphCentroid);
        return;
      }
      out.set(0, 0, 0);
      return;
    }
    if (this.followComet) {
      this.followComet.getHeadWorldPosition(out);
      return;
    }
    if (this.followPlanet?.mesh) {
      this.followPlanet.mesh.getWorldPosition(out);
      return;
    }
    out.set(0, 0, 0);
  }

  /**
   * Unit offset direction (pivot → camera) matching {@link _updateFollow} / {@link _updateGraphView}.
   * @param {number} theta
   * @param {number} phi
   * @param {import("three").Vector3} out
   */
  _directionFromSphericalOrbit(theta, phi, out) {
    const sinP = Math.sin(phi);
    out.set(sinP * Math.sin(theta), Math.cos(phi), sinP * Math.cos(theta));
  }

  /**
   * @param {import("three").Vector3} u - unit direction from pivot toward camera
   * @param {boolean} graph
   */
  _setOrbitYawPitchFromUnitDirection(u, graph) {
    const phi = Math.acos(THREE.MathUtils.clamp(u.y, -1, 1));
    const sinP = Math.sin(phi);
    const theta = Math.abs(sinP) > 1e-6 ? Math.atan2(u.x, u.z) : graph ? this._graphOrbitYaw : this._followOrbitYaw;
    if (graph) {
      this._graphOrbitPitch = phi;
      this._graphOrbitYaw = theta;
    } else {
      this._followOrbitPitch = phi;
      this._followOrbitYaw = theta;
    }
  }

  /**
   * Orthonormal tangent basis on the orbit sphere at `u`, aligned to camera screen right / up.
   * @param {import("three").Camera} cam
   * @param {import("three").Vector3} u - unit pivot→camera
   * @param {import("three").Vector3} tR - out: “screen right” tangent
   * @param {import("three").Vector3} tU - out: “screen up” tangent
   */
  _orbitScreenTangentBasis(cam, u, tR, tU) {
    cam.updateMatrixWorld(true);
    _scrRightDrag.set(1, 0, 0).applyQuaternion(cam.quaternion);
    _scrUpDrag.set(0, 1, 0).applyQuaternion(cam.quaternion);
    tR.copy(_scrRightDrag).addScaledVector(u, -_scrRightDrag.dot(u));
    if (tR.lengthSq() < 1e-10) {
      tR.copy(_worldUp).addScaledVector(u, -_worldUp.dot(u));
    }
    if (tR.lengthSq() < 1e-10) {
      tR.set(1, 0, 0).addScaledVector(u, -u.x);
    }
    tR.normalize();
    tU.copy(_scrUpDrag).addScaledVector(u, -_scrUpDrag.dot(u));
    tU.addScaledVector(tR, -tU.dot(tR));
    if (tU.lengthSq() < 1e-10) {
      tU.copy(tR).cross(u).normalize();
    } else {
      tU.normalize();
    }
  }

  /**
   * Drag moves the orbit direction in the camera’s screen plane: horizontal drag rotates around
   * screen-up axis; vertical drag around screen-right — so “left” always spins the scene left on
   * screen regardless of accumulated roll / under-the-pivot poses.
   * @param {number} dx
   * @param {number} dy
   * @param {HTMLElement} container
   */
  _applyScreenSpaceOrbitDrag(dx, dy, container) {
    const w = Math.max(container.clientWidth, 1);
    const h = Math.max(container.clientHeight, 1);
    const graph = this._graphMode;
    const turnFraction = graph ? GRAPH_ORBIT_DRAG_TURN_FRACTION : FOLLOW_ORBIT_DRAG_TURN_FRACTION;
    const horiz = (dx / w) * Math.PI * 2 * turnFraction;
    const vert = (dy / h) * Math.PI * 2 * turnFraction;

    this._fillOrbitPivotForDrag(_orbitPivotForDrag);
    const theta = graph ? this._graphOrbitYaw : this._followOrbitYaw;
    const phi = graph ? this._graphOrbitPitch : this._followOrbitPitch;
    this._directionFromSphericalOrbit(theta, phi, _uDirDrag);

    this._orbitScreenTangentBasis(this.camera, _uDirDrag, _tRDrag, _tUDrag);
    _uDirDrag.applyAxisAngle(_tRDrag, -vert);
    _uDirDrag.applyAxisAngle(_tUDrag, -horiz);
    _uDirDrag.normalize();
    this._setOrbitYawPitchFromUnitDirection(_uDirDrag, graph);
  }

  /**
   * Linear mapping: drag across full viewport width (or height) ⇒ SWIPE_TURN_FRACTION * 2π rad
   * in that axis (see SWIPE_DEGREES_PER_FULL_DRAG). Planet follow uses FOLLOW_ORBIT_DRAG_*.
   */
  _applyTouchOrbit(dx, dy, container) {
    const w = Math.max(container.clientWidth, 1);
    const h = Math.max(container.clientHeight, 1);
    const cam = this.camera;

    if (this.followPlanet || this.followComet || this._graphMode) {
      if (!this._graphMode) this._clearEnterPlanetInteriorHold();
      this._applyScreenSpaceOrbitDrag(dx, dy, container);
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

      if (this._graphMode) {
        const proxies = this.graphPickProxies || [];
        if (proxies.length > 0) {
          const hits = raycaster.intersectObjects(proxies, false);
          if (hits.length > 0) {
            const picked = hits[0].object.userData?.planet;
            if (picked) {
              this._beginGraphZoomToPlanet(picked);
            }
          }
        }
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
        return;
      }
      if (planetPick) {
        this._enterPlanetTween = null;
        this.followPlanet = planetPick;
        this.followComet = null;
        this.zoomActive = false;
        return;
      }

      // Fallback: clicking inside a planet's star cluster (anywhere within its pick proxy) tweens
      // toward that planet. Skip the currently followed planet so clicks near it don't re-tween.
      const proxies = this.graphPickProxies || [];
      if (proxies.length === 0) return;
      const proxyHits = raycaster.intersectObjects(proxies, false);
      if (proxyHits.length === 0) return;
      const pickedFromProxy = proxyHits[0].object.userData?.planet;
      if (pickedFromProxy && pickedFromProxy !== this.followPlanet) {
        this._beginGraphZoomToPlanet(pickedFromProxy);
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
   * Suspended while graph view is active or a tween (enter-planet / graph-zoom) is running.
   */
  _ensureFollowLocked() {
    if (this._graphMode) return;
    if (this._enterPlanetTween) return;
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
    this._planetInteriorExitSnapshot = null;
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
    this._capturePlanetInteriorExitSnapshot(planet);
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
   * Camera pose in the planet mesh’s local space + relative orientation (inverse planet world × camera world).
   * @param {{ mesh: import("three").Mesh }} planet
   */
  _capturePlanetInteriorExitSnapshot(planet) {
    const mesh = planet.mesh;
    mesh.updateWorldMatrix(true, true);
    _exitSnapshotInvMat.copy(mesh.matrixWorld).invert();
    const localPos = new THREE.Vector3().copy(this.camera.position).applyMatrix4(_exitSnapshotInvMat);
    mesh.getWorldQuaternion(_exitSnapshotMeshQ);
    this.camera.getWorldQuaternion(_exitSnapshotCamQ);
    const relQuat = _exitSnapshotMeshQ.clone().invert().multiply(_exitSnapshotCamQ);
    this._planetInteriorExitSnapshot = { planet, localPos, relQuat };
  }

  /**
   * Recompute follow yaw/pitch from camera offset so orbit controls match the restored position.
   * @param {{ mesh: import("three").Mesh }} planet
   */
  _syncFollowOrbitAnglesFromCamera(planet) {
    const mesh = planet.mesh;
    if (!mesh) return;
    const orbitCenter = new THREE.Vector3();
    mesh.getWorldPosition(orbitCenter);
    _exitSnapshotOffset.copy(this.camera.position).sub(orbitCenter);
    const r = _exitSnapshotOffset.length();
    if (r < 1e-8) return;
    const cosPhi = THREE.MathUtils.clamp(_exitSnapshotOffset.y / r, -1, 1);
    const phi = Math.acos(cosPhi);
    const sinP = Math.sin(phi);
    const theta = Math.abs(sinP) > 1e-6 ? Math.atan2(_exitSnapshotOffset.x, _exitSnapshotOffset.z) : 0;
    this._followOrbitPitch = phi;
    this._followOrbitYaw = theta;
  }

  /**
   * Restore camera to the pose saved at the last “Enter planet” click (planet-local), then resume orbit follow.
   * @param {{ mesh: import("three").Mesh }} planet
   */
  animateExitPlanet(planet) {
    if (!planet?.mesh) return;
    const snap = this._planetInteriorExitSnapshot;
    if (!snap || snap.planet !== planet) {
      this._enterPlanetTween = null;
      this._enterPlanetInteriorHold = false;
      if (this.followPlanet?.mesh) {
        this._syncFollowOrbitAnglesFromCamera(this.followPlanet);
        this._syncFollowOrbitScaleFromCameraPosition();
      }
      return;
    }
    this._enterPlanetTween = null;
    this._enterPlanetInteriorHold = false;
    planet.mesh.updateWorldMatrix(true, true);
    this.camera.position.copy(snap.localPos).applyMatrix4(planet.mesh.matrixWorld);
    planet.mesh.getWorldQuaternion(_exitSnapshotMeshQ);
    this.camera.quaternion.copy(_exitSnapshotMeshQ).multiply(snap.relQuat);
    this._planetInteriorExitSnapshot = null;
    this._syncFollowOrbitAnglesFromCamera(planet);
    this._syncFollowOrbitScaleFromCameraPosition();
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
    if (tw.startQuat && tw.endQuat) {
      this.camera.quaternion.slerpQuaternions(tw.startQuat, tw.endQuat, e);
    } else {
      this.camera.lookAt(tw.center);
    }
    if (u < 1) return;
    if (tw.kind === "graphZoom" && tw.planet?.mesh) {
      // Hand off to normal follow mode without triggering the change-detector reset.
      this._enterPlanetTween = null;
      this._enterPlanetInteriorHold = false;
      this.followPlanet = tw.planet;
      this.followComet = null;
      this._lastFollowPlanet = tw.planet;
      this._introOrbitActive = false;
      this._syncFollowOrbitAnglesFromCamera(tw.planet);
      this._syncFollowOrbitScaleFromCameraPosition();
      return;
    }
    this._enterPlanetTween = null;
    this._enterPlanetInteriorHold = true;
  }

  /**
   * Build the world-space camera orientation for an orbit camera at (yaw, pitch) around a pivot.
   * Convention matches the spherical-coordinate position formula used in {@link _updateFollow} and
   * {@link _updateGraphView}: `pitch = π/2`, `yaw = 0` is the canonical "front equator" view (camera
   * at +Z looking -Z). `pitch = 0` is straight above; `pitch = π` is straight below. Values outside
   * [0, π] continue the great-circle smoothly. {@link _applyOrbitRollStabilization} then eases roll
   * toward a world-up `lookAt` when the free quaternion would put the sky upside-down on screen.
   * Result is written into {@link _qOrbitScratch} and returned.
   * @param {number} yaw - radians around world +Y
   * @param {number} pitch - polar angle from world +Y in radians
   * @returns {THREE.Quaternion} reused scratch quaternion (do not retain across frames)
   */
  _orbitQuaternion(yaw, pitch) {
    _qPitchScratch.setFromAxisAngle(_worldRight, pitch - Math.PI / 2);
    _qYawScratch.setFromAxisAngle(_worldUp, yaw);
    _qOrbitScratch.copy(_qYawScratch).multiply(_qPitchScratch);
    return _qOrbitScratch;
  }

  /**
   * Blend the free-orbit quaternion toward the same forward (eye→pivot) but with roll aligned to
   * world +Y via {@link THREE.PerspectiveCamera.prototype.lookAt}, so swinging under the target does
   * not leave the horizon permanently inverted. Skipped near the vertical look-at singularity.
   * @param {import("three").Vector3} eye
   * @param {import("three").Vector3} pivot
   * @param {import("three").Quaternion} qFree
   * @param {import("three").Quaternion} out
   */
  _applyOrbitRollStabilization(eye, pivot, qFree, out) {
    _fwdAxisScratch.set(0, 0, -1).applyQuaternion(qFree);
    if (Math.abs(_fwdAxisScratch.y) > ORBIT_ROLL_LOOKAT_SKIP_AXIS_Y) {
      out.copy(qFree);
      return;
    }
    _orbitLookCam.position.copy(eye);
    _orbitLookCam.up.copy(_worldUp);
    _orbitLookCam.lookAt(pivot);
    _qUprightLookScratch.copy(_orbitLookCam.quaternion);

    _camUpAxisScratch.set(0, 1, 0).applyQuaternion(qFree);
    const denom = ORBIT_ROLL_BLEND_FROM_CAM_UP_Y - ORBIT_ROLL_BLEND_TO_CAM_UP_Y;
    let lev = (ORBIT_ROLL_BLEND_FROM_CAM_UP_Y - _camUpAxisScratch.y) / denom;
    lev = THREE.MathUtils.clamp(lev, 0, 1);

    out.copy(qFree);
    if (lev <= 1e-5) return;
    out.slerp(_qUprightLookScratch, lev);
  }

  /**
   * Desktop: snap orbit angles to a neutral "in front, right-side up" pose when disoriented.
   * Press **R** (not while typing in a field or lil-gui).
   */
  _recoverLevelOrbitView() {
    if (this._enterPlanetTween) return;
    if (this._graphMode) {
      this._graphOrbitYaw = 0;
      this._graphOrbitPitch = Math.PI / 2;
      return;
    }
    if (this.followPlanet || this.followComet) {
      this._followOrbitYaw = 0;
      this._followOrbitPitch = this._defaultFollowPitch();
    }
  }

  /**
   * Current world-space orbit distance from the active follow target (planet or comet).
   * @returns {number}
   */
  _currentFollowOrbitDistance() {
    const offsetY = this.isMobile ? 8 : 5;
    const offsetZ = this.isMobile ? 20 : 12;
    const baseR = Math.hypot(offsetY, offsetZ);
    return baseR * this._followDistanceScale;
  }

  /**
   * Flip into the planet-graph view: clear follow target but remember which planet we zoomed out from
   * (so the graph orbit stays centered on it). Initial yaw/pitch are seeded from the camera's current
   * direction relative to that planet so the transition is visually continuous.
   */
  _enterGraphMode() {
    if (this._graphMode) return;
    this._graphMode = true;
    this._lastFollowedPlanetForGraph = this.followPlanet;
    const orbitCenter = this._getGraphOrbitCenter();
    this.followPlanet = null;
    this.followComet = null;
    this._introOrbitActive = false;
    this._enterPlanetTween = null;
    this._enterPlanetInteriorHold = false;
    const offset = this.camera.position.clone().sub(orbitCenter);
    const r = Math.max(offset.length(), GRAPH_MODE_DISTANCE_THRESHOLD);
    this._graphOrbitDistance = THREE.MathUtils.clamp(
      r,
      GRAPH_MODE_DISTANCE_THRESHOLD,
      GRAPH_ORBIT_DISTANCE_MAX
    );
    if (offset.lengthSq() < 1e-6) {
      this._graphOrbitYaw = 0;
      this._graphOrbitPitch = Math.PI / 2;
      return;
    }
    const cosPhi = THREE.MathUtils.clamp(offset.y / offset.length(), -1, 1);
    this._graphOrbitPitch = Math.acos(cosPhi);
    const sinP = Math.sin(this._graphOrbitPitch);
    this._graphOrbitYaw = Math.abs(sinP) > 1e-6 ? Math.atan2(offset.x, offset.z) : 0;
  }

  /**
   * World-space pivot for the graph-view orbit. Prefers the planet we zoomed out from so the user's
   * spatial sense of "I was just here" is preserved; falls back to the centroid otherwise.
   * @returns {THREE.Vector3}
   */
  _getGraphOrbitCenter() {
    const target = this._lastFollowedPlanetForGraph;
    if (target?.mesh) {
      const v = new THREE.Vector3();
      target.mesh.getWorldPosition(v);
      return v;
    }
    return this.graphCentroid ? this.graphCentroid.clone() : new THREE.Vector3(0, 0, 0);
  }

  /**
   * Wheel-zoom past the (hysteresis) threshold leaves graph view: re-lock to the previously followed
   * planet (or fallback) and sync follow orbit state to the camera's current pose so there's no pop.
   */
  _exitGraphModeToFollow() {
    if (!this._graphMode) return;
    this._graphMode = false;
    let target = this._lastFollowedPlanetForGraph;
    if (!target?.mesh && this._fallbackFollowPlanet?.mesh) {
      target = this._fallbackFollowPlanet;
    }
    if (!target?.mesh) return;
    this.followPlanet = target;
    this._lastFollowPlanet = target;
    this._introOrbitActive = false;
    this._enterPlanetTween = null;
    this._enterPlanetInteriorHold = false;
    this._syncFollowOrbitAnglesFromCamera(target);
    this._syncFollowOrbitScaleFromCameraPosition();
  }

  /**
   * Click-on-cluster path in graph view: kick off a {@link _enterPlanetTween} with `kind: "graphZoom"`
   * that lerps the camera from its current position to the picked planet's normal follow shell, then
   * hands control back to {@link _updateFollow} on completion.
   * @param {{ mesh: import("three").Mesh, def?: { radius?: number } }} planet
   */
  _beginGraphZoomToPlanet(planet) {
    if (!planet?.mesh) return;
    this._graphMode = false;
    this._enterPlanetInteriorHold = false;
    planet.mesh.updateWorldMatrix(true, true);
    const center = new THREE.Vector3();
    planet.mesh.getWorldPosition(center);
    const offsetY = this.isMobile ? 8 : 5;
    const offsetZ = this.isMobile ? 20 : 12;
    const baseR = Math.hypot(offsetY, offsetZ);
    // Land along the line camera→planet so the user-visible direction is preserved.
    const dir = this.camera.position.clone().sub(center);
    if (dir.lengthSq() < 1e-6) dir.set(0, offsetY, offsetZ);
    dir.normalize().multiplyScalar(baseR);
    const end = center.clone().add(dir);
    // Capture start/end orientations so the tween can slerp instead of snap-looking at the picked
    // planet on the first frame. Matrix4.lookAt(eye, target, up) matches Camera.lookAt's convention.
    const startQuat = this.camera.quaternion.clone();
    const endMat = new THREE.Matrix4().lookAt(end, center, this.camera.up);
    const endQuat = new THREE.Quaternion().setFromRotationMatrix(endMat);
    this._enterPlanetTween = {
      elapsed: 0,
      duration: GRAPH_ZOOM_TWEEN_DURATION_SEC,
      start: this.camera.position.clone(),
      end,
      center: center.clone(),
      startQuat,
      endQuat,
      kind: "graphZoom",
      planet,
    };
  }

  /**
   * Orbit the planet we zoomed out from at {@link _graphOrbitDistance} world units, controlled by
   * accumulated yaw/pitch from drag input. Called from {@link update} when {@link _graphMode} is true.
   * @param {number} _dt
   */
  _updateGraphView(_dt) {
    const cam = this.camera;
    const center = this._getGraphOrbitCenter();
    const phi = this._graphOrbitPitch;
    const theta = this._graphOrbitYaw;
    const sinP = Math.sin(phi);
    const r = this._graphOrbitDistance;
    const offset = new THREE.Vector3(
      r * sinP * Math.sin(theta),
      r * Math.cos(phi),
      r * sinP * Math.cos(theta)
    );
    const ideal = center.clone().add(offset);
    const t = this.isMobile ? 0.06 : 0.04;
    cam.position.lerp(ideal, t);
    const qFree = this._orbitQuaternion(theta, phi);
    this._applyOrbitRollStabilization(ideal, center, qFree, _qRollStabilizedScratch);
    cam.quaternion.slerp(_qRollStabilizedScratch, t);
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
      if (!this.followPlanet) {
        this._planetInteriorExitSnapshot = null;
      } else if (
        this._planetInteriorExitSnapshot &&
        this._planetInteriorExitSnapshot.planet !== this.followPlanet
      ) {
        this._planetInteriorExitSnapshot = null;
      }
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
    if (this._graphMode) {
      this._updateGraphView(dt);
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
    const phi = this._followOrbitPitch;
    const theta = this._followOrbitYaw;
    const sinP = Math.sin(phi);
    const r = worldDistance;
    const offset = new THREE.Vector3(
      r * sinP * Math.sin(theta),
      r * Math.cos(phi),
      r * sinP * Math.cos(theta)
    );
    cam.position.copy(orbitCenter).add(offset);
    const qFree = this._orbitQuaternion(theta, phi);
    this._applyOrbitRollStabilization(cam.position, orbitCenter, qFree, _qRollStabilizedScratch);
    cam.quaternion.copy(_qRollStabilizedScratch);
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
    const phi = this._followOrbitPitch;
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
    const qFree = this._orbitQuaternion(theta, phi);
    this._applyOrbitRollStabilization(ideal, orbitCenter, qFree, _qRollStabilizedScratch);
    cam.quaternion.slerp(_qRollStabilizedScratch, lerpT);
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
