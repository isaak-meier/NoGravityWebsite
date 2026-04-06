/** @vitest-environment jsdom */
import { describe, it, expect, beforeEach } from 'vitest';
import FLAGS, { isEnabled, setFlag } from './feature-flags.js';

describe('feature-flags', () => {
  // ── isEnabled ──────────────────────────────────────────────────────────

  describe('isEnabled', () => {
    it('returns true for flags that are truthy', () => {
      // ENABLE_GUI defaults to true
      expect(isEnabled('ENABLE_GUI')).toBe(true);
    });

    it('returns true for ENABLE_UPLOAD by default', () => {
      expect(isEnabled('ENABLE_UPLOAD')).toBe(true);
    });

    it('returns false for unknown / undefined flags', () => {
      // a flag that was never defined should be falsy
      expect(isEnabled('NON_EXISTENT_FLAG')).toBe(false);
    });

    it('coerces result to boolean (never returns raw value)', () => {
      FLAGS['STRING_FLAG'] = 'hello';
      expect(isEnabled('STRING_FLAG')).toBe(true);
      expect(typeof isEnabled('STRING_FLAG')).toBe('boolean');
      delete FLAGS['STRING_FLAG'];
    });

    it('returns false when the flag is explicitly set to 0', () => {
      FLAGS['ZERO_FLAG'] = 0;
      expect(isEnabled('ZERO_FLAG')).toBe(false);
      delete FLAGS['ZERO_FLAG'];
    });

    it('returns false when the flag is null', () => {
      FLAGS['NULL_FLAG'] = null;
      expect(isEnabled('NULL_FLAG')).toBe(false);
      delete FLAGS['NULL_FLAG'];
    });
  });

  // ── setFlag ────────────────────────────────────────────────────────────

  describe('setFlag', () => {
    // restore original values after each test
    let origGui, origUpload;
    beforeEach(() => {
      origGui = FLAGS['ENABLE_GUI'];
      origUpload = FLAGS['ENABLE_UPLOAD'];
    });

    // cleanup helper (runs in afterEach-like style via beforeEach next)
    afterEach(() => {
      FLAGS['ENABLE_GUI'] = origGui;
      FLAGS['ENABLE_UPLOAD'] = origUpload;
    });

    it('can disable a previously enabled flag', () => {
      setFlag('ENABLE_GUI', false);
      expect(isEnabled('ENABLE_GUI')).toBe(false);
    });

    it('can re-enable a disabled flag', () => {
      setFlag('ENABLE_GUI', false);
      setFlag('ENABLE_GUI', true);
      expect(isEnabled('ENABLE_GUI')).toBe(true);
    });

    it('coerces truthy values to boolean true', () => {
      setFlag('ENABLE_GUI', 'yes');
      expect(FLAGS['ENABLE_GUI']).toBe(true);
    });

    it('coerces falsy values to boolean false', () => {
      setFlag('ENABLE_GUI', 0);
      expect(FLAGS['ENABLE_GUI']).toBe(false);
      setFlag('ENABLE_GUI', '');
      expect(FLAGS['ENABLE_GUI']).toBe(false);
    });

    it('can create a new flag at runtime', () => {
      setFlag('MY_CUSTOM_FLAG', true);
      expect(isEnabled('MY_CUSTOM_FLAG')).toBe(true);
      delete FLAGS['MY_CUSTOM_FLAG'];
    });
  });

  // ── default export (FLAGS object) ──────────────────────────────────────

  describe('FLAGS default export', () => {
    it('exposes ENABLE_GUI and ENABLE_UPLOAD keys', () => {
      expect('ENABLE_GUI' in FLAGS).toBe(true);
      expect('ENABLE_UPLOAD' in FLAGS).toBe(true);
    });

    it('allows direct introspection of raw values', () => {
      // directly reading the object should reflect setFlag changes
      setFlag('ENABLE_GUI', false);
      expect(FLAGS['ENABLE_GUI']).toBe(false);
      setFlag('ENABLE_GUI', true);
      expect(FLAGS['ENABLE_GUI']).toBe(true);
    });
  });
});

// need afterEach from vitest
import { afterEach } from 'vitest';
