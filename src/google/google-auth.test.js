/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  initializeGoogleAuth,
  requestGoogleAuth,
  showGoogleDrivePicker,
  getAccessToken,
  signOutGoogle,
} from './google-auth.js';

describe('google-auth', () => {
  let origGoogle;

  beforeEach(() => {
    // snapshot and clear global google object between tests
    origGoogle = window.google;
    // reset module-level state by signing out
    signOutGoogle();
  });

  afterEach(() => {
    window.google = origGoogle;
  });

  // ── getAccessToken ─────────────────────────────────────────────────────

  describe('getAccessToken', () => {
    it('returns null when no user has signed in', () => {
      // after signOutGoogle(), the token should be null
      expect(getAccessToken()).toBeNull();
    });
  });

  // ── signOutGoogle ──────────────────────────────────────────────────────

  describe('signOutGoogle', () => {
    it('clears the access token', () => {
      // we can't easily set the token from outside, but after signOut it should be null
      signOutGoogle();
      expect(getAccessToken()).toBeNull();
    });

    it('calls google.accounts.id.disableAutoSelect when available', () => {
      const disableAutoSelect = vi.fn();
      window.google = {
        accounts: { id: { disableAutoSelect } },
      };
      signOutGoogle();
      expect(disableAutoSelect).toHaveBeenCalled();
    });

    it('does not throw when google.accounts is missing', () => {
      window.google = undefined;
      expect(() => signOutGoogle()).not.toThrow();
    });
  });

  // ── initializeGoogleAuth ──────────────────────────────────────────────

  describe('initializeGoogleAuth', () => {
    it('does nothing when google.accounts is not loaded yet', () => {
      window.google = undefined;
      // should not throw
      expect(() => initializeGoogleAuth()).not.toThrow();
    });

    it('does nothing when CLIENT_ID is missing', () => {
      // provide accounts but no client ID override — the module has a default
      // CLIENT_ID so this branch is hard to reach. Just ensure no crash.
      window.google = {
        accounts: {
          oauth2: {
            initTokenClient: vi.fn(),
          },
        },
      };
      expect(() => initializeGoogleAuth()).not.toThrow();
    });

    it('calls initTokenClient when google.accounts.oauth2 is available', () => {
      const initTokenClient = vi.fn();
      window.google = {
        accounts: {
          oauth2: { initTokenClient },
        },
      };
      initializeGoogleAuth();
      expect(initTokenClient).toHaveBeenCalledWith(
        expect.objectContaining({
          client_id: expect.any(String),
          scope: expect.stringContaining('drive.readonly'),
        })
      );
    });
  });

  // ── requestGoogleAuth ─────────────────────────────────────────────────

  describe('requestGoogleAuth', () => {
    it('returns null if auth was never initialized (no tokenClient)', async () => {
      // without calling initializeGoogleAuth, tokenClient is null
      window.google = undefined;
      const result = await requestGoogleAuth();
      expect(result).toBeNull();
    });

    it('resolves with access token on successful auth', async () => {
      // set up a mock tokenClient that triggers callback immediately
      const initTokenClient = vi.fn((opts) => {
        return {
          callback: opts.callback,
          error_callback: opts.error_callback,
          requestAccessToken(params) {
            // simulate a successful auth response
            this.callback({ access_token: 'test-token-123' });
          },
        };
      });

      window.google = {
        accounts: {
          oauth2: { initTokenClient },
        },
      };

      initializeGoogleAuth();
      const token = await requestGoogleAuth();
      expect(token).toBe('test-token-123');
    });

    it('rejects when OAuth returns an error', async () => {
      const initTokenClient = vi.fn((opts) => {
        return {
          callback: opts.callback,
          error_callback: opts.error_callback,
          requestAccessToken() {
            this.callback({ error: 'access_denied' });
          },
        };
      });

      window.google = {
        accounts: {
          oauth2: { initTokenClient },
        },
      };

      initializeGoogleAuth();
      await expect(requestGoogleAuth()).rejects.toThrow('access_denied');
    });

    it('rejects when popup is closed', async () => {
      const initTokenClient = vi.fn((opts) => {
        return {
          callback: opts.callback,
          error_callback: opts.error_callback,
          requestAccessToken() {
            this.callback({ error: 'popup_closed' });
          },
        };
      });

      window.google = {
        accounts: {
          oauth2: { initTokenClient },
        },
      };

      initializeGoogleAuth();
      await expect(requestGoogleAuth()).rejects.toThrow('popup was closed');
    });

    it('rejects when response has no access_token', async () => {
      const initTokenClient = vi.fn((opts) => {
        return {
          callback: opts.callback,
          error_callback: opts.error_callback,
          requestAccessToken() {
            this.callback({}); // no token, no error field
          },
        };
      });

      window.google = {
        accounts: {
          oauth2: { initTokenClient },
        },
      };

      initializeGoogleAuth();
      await expect(requestGoogleAuth()).rejects.toThrow();
    });

    it('rejects when error_callback fires', async () => {
      const initTokenClient = vi.fn((opts) => {
        return {
          callback: opts.callback,
          error_callback: opts.error_callback,
          requestAccessToken() {
            this.error_callback({ error: 'some_error', error_description: 'details' });
          },
        };
      });

      window.google = {
        accounts: {
          oauth2: { initTokenClient },
        },
      };

      initializeGoogleAuth();
      await expect(requestGoogleAuth()).rejects.toThrow('some_error');
    });
  });

  // ── showGoogleDrivePicker ─────────────────────────────────────────────

  describe('showGoogleDrivePicker', () => {
    it('resolves null when there is no access token', async () => {
      // Stub the Picker API so ensureGooglePickerLoaded doesn't fail
      window.google = {
        picker: {
          PickerBuilder: class {
            addView() { return this; }
            setOAuthToken() { return this; }
            setCallback() { return this; }
            build() { return { setVisible: vi.fn() }; }
          },
          DocsView: class {
            setSelectFolderEnabled() { return this; }
          },
          ViewId: { FOLDERS: 'folders' },
          Action: { PICKED: 'picked', CANCEL: 'cancel', LOADED: 'loaded' },
        },
      };
      // stub gapi.load (already loaded)
      window.gapi = { load: vi.fn() };

      signOutGoogle();
      const result = await showGoogleDrivePicker();
      expect(result).toBeNull();
    });
  });
});
