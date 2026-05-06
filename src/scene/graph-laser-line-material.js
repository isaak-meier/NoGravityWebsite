import * as THREE from "three";

/**
 * @returns {THREE.ShaderMaterial} Additive line material with traveling “beam” pulses (see {@link SolarSystem} graph edges).
 */
export function createGraphLaserLineMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uMusicPulse: { value: 0 },
      uBass: { value: 0 },
      uBars0to3: { value: new THREE.Vector4(0, 0, 0, 0) },
      uBars4to7: { value: new THREE.Vector4(0, 0, 0, 0) },
      /** 0 = hidden, 1 = visible — toggles every 8 musical bars (see {@link SolarSystem#setGraphLaserEightBarPhase}). */
      uLaserCycle: { value: 1 },
    },
    vertexShader: `
      attribute float lineProgress;
      attribute float edgePhase;
      attribute float barIndex;
      varying float vLineT;
      varying float vPhase;
      varying float vBarIdx;

      void main() {
        vLineT = lineProgress;
        vPhase = edgePhase;
        vBarIdx = barIndex;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      varying float vLineT;
      varying float vPhase;
      varying float vBarIdx;
      uniform float uTime;
      uniform float uMusicPulse;
      uniform float uBass;
      uniform vec4 uBars0to3;
      uniform vec4 uBars4to7;
      uniform float uLaserCycle;

      float eqBarLevel(float bi) {
        vec4 w0 = vec4(
          1.0 - step(0.5, bi),
          step(0.5, bi) * (1.0 - step(1.5, bi)),
          step(1.5, bi) * (1.0 - step(2.5, bi)),
          step(2.5, bi) * (1.0 - step(3.5, bi))
        );
        vec4 w1 = vec4(
          step(3.5, bi) * (1.0 - step(4.5, bi)),
          step(4.5, bi) * (1.0 - step(5.5, bi)),
          step(5.5, bi) * (1.0 - step(6.5, bi)),
          step(6.5, bi) * (1.0 - step(7.5, bi))
        );
        return dot(uBars0to3, w0) + dot(uBars4to7, w1);
      }

      void main() {
        float speed = 3.5 + uMusicPulse * 7.0 + uBass * 4.0;
        float travel = vLineT * 9.0 - uTime * speed + vPhase;
        float wave = sin(travel) * 0.5 + 0.5;
        float beam = pow(max(wave, 0.02), 2.4);
        float tip = smoothstep(0.88, 1.0, vLineT) * (sin(uTime * 14.0 + vPhase) * 0.5 + 0.5);
        float drive = 0.2 + uMusicPulse * 0.75 + uBass * 0.45;
        float alpha = drive * (0.28 + beam * 1.15 + tip * 0.5);
        alpha = clamp(alpha, 0.0, 1.0);
        float eqLvl = eqBarLevel(vBarIdx);
        float barGate = step(0.14, eqLvl);
        alpha *= barGate;
        alpha *= clamp(uLaserCycle, 0.0, 1.0);
        vec3 core = mix(vec3(0.25, 0.95, 1.0), vec3(1.0, 0.55, 1.0), beam);
        vec3 glow = mix(vec3(0.5, 0.85, 1.0), vec3(1.0, 0.9, 1.0), tip);
        vec3 rgb = mix(core, glow, tip * 0.35) * (0.85 + uMusicPulse * 0.95 + uBass * 0.35);
        gl_FragColor = vec4(rgb, alpha);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
}
