/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import GoogleDriveAudioProvider from './google-drive-audio.js';

describe('GoogleDriveAudioProvider', () => {
  beforeEach(() => {
    global.fetch = vi.fn();
  });

  // ── constructor ────────────────────────────────────────────────────────

  describe('constructor', () => {
    it('throws when folderId is missing', () => {
      expect(() => new GoogleDriveAudioProvider()).toThrow('folderId is required');
    });

    it('throws when called with an empty options object', () => {
      expect(() => new GoogleDriveAudioProvider({})).toThrow('folderId is required');
    });

    it('stores folderId on the instance', () => {
      const p = new GoogleDriveAudioProvider({ folderId: 'abc' });
      expect(p.folderId).toBe('abc');
    });

    it('stores apiKey when provided', () => {
      const p = new GoogleDriveAudioProvider({ folderId: 'abc', apiKey: 'KEY' });
      expect(p.apiKey).toBe('KEY');
    });

    it('stores accessToken when provided', () => {
      const p = new GoogleDriveAudioProvider({ folderId: 'abc', accessToken: 'tok' });
      expect(p.accessToken).toBe('tok');
    });

    it('defaults apiKey and accessToken to null', () => {
      const p = new GoogleDriveAudioProvider({ folderId: 'abc' });
      expect(p.apiKey).toBeNull();
      expect(p.accessToken).toBeNull();
    });

    it('accepts both apiKey and accessToken at the same time', () => {
      const p = new GoogleDriveAudioProvider({ folderId: 'x', apiKey: 'K', accessToken: 'T' });
      expect(p.apiKey).toBe('K');
      expect(p.accessToken).toBe('T');
    });
  });

  // ── getDownloadUrl ─────────────────────────────────────────────────────

  describe('getDownloadUrl', () => {
    it('builds URL with apiKey appended', () => {
      const p = new GoogleDriveAudioProvider({ folderId: 'abc', apiKey: 'KEY' });
      expect(p.getDownloadUrl('file1')).toBe(
        'https://www.googleapis.com/drive/v3/files/file1?alt=media&key=KEY'
      );
    });

    it('builds URL without apiKey when none is set', () => {
      const p = new GoogleDriveAudioProvider({ folderId: 'abc' });
      const url = p.getDownloadUrl('file1');
      expect(url).toBe('https://www.googleapis.com/drive/v3/files/file1?alt=media');
      expect(url).not.toContain('key=');
    });

    it('includes the exact file ID in the URL path', () => {
      const p = new GoogleDriveAudioProvider({ folderId: 'f', apiKey: 'K' });
      const url = p.getDownloadUrl('some-long-id-123');
      expect(url).toContain('/files/some-long-id-123?');
    });
  });

  // ── _fetch (internal, tested indirectly) ───────────────────────────────

  describe('_fetch (via listFiles)', () => {
    it('sends Authorization header when accessToken is set', async () => {
      global.fetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({ files: [] }) });
      const p = new GoogleDriveAudioProvider({ folderId: 'F', accessToken: 'mytoken' });
      await p.listFiles();
      const opts = global.fetch.mock.calls[0][1];
      expect(opts.headers['Authorization']).toBe('Bearer mytoken');
    });

    it('does not send Authorization header when accessToken is null', async () => {
      global.fetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({ files: [] }) });
      const p = new GoogleDriveAudioProvider({ folderId: 'F' });
      await p.listFiles();
      const opts = global.fetch.mock.calls[0][1];
      expect(opts.headers['Authorization']).toBeUndefined();
    });

    it('throws with status code when response is not ok', async () => {
      global.fetch.mockResolvedValue({ ok: false, status: 404, json: () => Promise.resolve({}) });
      const p = new GoogleDriveAudioProvider({ folderId: 'F' });
      await expect(p.listFiles()).rejects.toThrow('Drive API error 404');
    });
  });

  // ── listFiles ──────────────────────────────────────────────────────────

  describe('listFiles', () => {
    it('returns files array from API response', async () => {
      const fakeResp = { files: [{ id: '1', name: 'a.mp3', mimeType: 'audio/mpeg' }] };
      global.fetch.mockResolvedValue({ ok: true, json: () => Promise.resolve(fakeResp) });
      const p = new GoogleDriveAudioProvider({ folderId: 'FOLDER', apiKey: 'K' });
      const files = await p.listFiles();
      expect(files).toEqual(fakeResp.files);
    });

    it('constructs query with audio MIME type filter', async () => {
      global.fetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({ files: [] }) });
      const p = new GoogleDriveAudioProvider({ folderId: 'F', apiKey: 'K' });
      await p.listFiles();
      const url = global.fetch.mock.calls[0][0];
      // query should filter to audio/* MIME types
      expect(url).toContain("mimeType+contains+%27audio%2F%27");
    });

    it('includes folderId and apiKey in the URL', async () => {
      global.fetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({ files: [] }) });
      const p = new GoogleDriveAudioProvider({ folderId: 'MY_FOLDER', apiKey: 'MY_KEY' });
      await p.listFiles();
      const url = global.fetch.mock.calls[0][0];
      expect(url).toContain('MY_FOLDER');
      expect(url).toContain('key=MY_KEY');
    });

    it('returns empty array when API response has no files property', async () => {
      global.fetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({}) });
      const p = new GoogleDriveAudioProvider({ folderId: 'F' });
      const files = await p.listFiles();
      expect(files).toEqual([]);
    });

    it('returns multiple files correctly', async () => {
      const fakeResp = {
        files: [
          { id: '1', name: 'track1.mp3', mimeType: 'audio/mpeg' },
          { id: '2', name: 'track2.wav', mimeType: 'audio/wav' },
          { id: '3', name: 'track3.ogg', mimeType: 'audio/ogg' },
        ],
      };
      global.fetch.mockResolvedValue({ ok: true, json: () => Promise.resolve(fakeResp) });
      const p = new GoogleDriveAudioProvider({ folderId: 'F' });
      const files = await p.listFiles();
      expect(files).toHaveLength(3);
      expect(files[1].name).toBe('track2.wav');
    });

    it('throws on network/API error', async () => {
      global.fetch.mockResolvedValue({ ok: false, status: 500, json: () => Promise.resolve({}) });
      const p = new GoogleDriveAudioProvider({ folderId: 'F' });
      await expect(p.listFiles()).rejects.toThrow('Drive API error 500');
    });
  });

  // ── listAllFiles ───────────────────────────────────────────────────────

  describe('listAllFiles', () => {
    it('returns all files without MIME filter', async () => {
      const fakeResp = {
        files: [
          { id: '1', name: 'song.mp3', mimeType: 'audio/mpeg' },
          { id: '2', name: 'photo.jpg', mimeType: 'image/jpeg' },
        ],
      };
      global.fetch.mockResolvedValue({ ok: true, json: () => Promise.resolve(fakeResp) });
      const p = new GoogleDriveAudioProvider({ folderId: 'F', apiKey: 'K' });
      const files = await p.listAllFiles();
      expect(files).toHaveLength(2);
    });

    it('does NOT contain audio MIME filter in query', async () => {
      global.fetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({ files: [] }) });
      const p = new GoogleDriveAudioProvider({ folderId: 'F' });
      await p.listAllFiles();
      const url = global.fetch.mock.calls[0][0];
      // should not have the audio filter
      expect(url).not.toContain('audio');
    });

    it('still filters to non-trashed files in the folder', async () => {
      global.fetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({ files: [] }) });
      const p = new GoogleDriveAudioProvider({ folderId: 'FID' });
      await p.listAllFiles();
      const url = global.fetch.mock.calls[0][0];
      expect(url).toContain('FID');
      expect(url).toContain('trashed');
    });

    it('includes apiKey when provided', async () => {
      global.fetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({ files: [] }) });
      const p = new GoogleDriveAudioProvider({ folderId: 'F', apiKey: 'ABC' });
      await p.listAllFiles();
      const url = global.fetch.mock.calls[0][0];
      expect(url).toContain('key=ABC');
    });

    it('returns empty array when API gives no files property', async () => {
      global.fetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({}) });
      const p = new GoogleDriveAudioProvider({ folderId: 'F' });
      const files = await p.listAllFiles();
      expect(files).toEqual([]);
    });

    it('throws on API error', async () => {
      global.fetch.mockResolvedValue({ ok: false, status: 403, json: () => Promise.resolve({}) });
      const p = new GoogleDriveAudioProvider({ folderId: 'F' });
      await expect(p.listAllFiles()).rejects.toThrow('Drive API error 403');
    });
  });

  // ── getFolder ──────────────────────────────────────────────────────────

  describe('getFolder', () => {
    it('returns folder metadata (id, name)', async () => {
      const fakeResp = { id: 'FOLDER_ID', name: 'My Folder' };
      global.fetch.mockResolvedValue({ ok: true, json: () => Promise.resolve(fakeResp) });
      const p = new GoogleDriveAudioProvider({ folderId: 'FOLDER_ID', accessToken: 'token' });
      const folder = await p.getFolder();
      expect(folder).toEqual(fakeResp);
    });

    it('requests fields=id,name', async () => {
      global.fetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({ id: 'X', name: 'Y' }) });
      const p = new GoogleDriveAudioProvider({ folderId: 'X' });
      await p.getFolder();
      const url = global.fetch.mock.calls[0][0];
      expect(url).toContain('fields=id%2Cname');
    });

    it('uses the folderId in the URL path', async () => {
      global.fetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({ id: 'ABC' }) });
      const p = new GoogleDriveAudioProvider({ folderId: 'ABC' });
      await p.getFolder();
      const url = global.fetch.mock.calls[0][0];
      expect(url).toContain('/drive/v3/files/ABC?');
    });

    it('includes apiKey in URL when set', async () => {
      global.fetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({}) });
      const p = new GoogleDriveAudioProvider({ folderId: 'F', apiKey: 'KEY' });
      await p.getFolder();
      const url = global.fetch.mock.calls[0][0];
      expect(url).toContain('key=KEY');
    });

    it('throws on API failure', async () => {
      global.fetch.mockResolvedValue({ ok: false, status: 401, json: () => Promise.resolve({}) });
      const p = new GoogleDriveAudioProvider({ folderId: 'F' });
      await expect(p.getFolder()).rejects.toThrow('Drive API error 401');
    });
  });

  // ── fetchFileBlob ──────────────────────────────────────────────────────

  describe('fetchFileBlob', () => {
    it('fetches file content as blob with Authorization header', async () => {
      const fakeBlob = new Blob(['audio-data'], { type: 'audio/mpeg' });
      global.fetch.mockResolvedValue({ ok: true, blob: () => Promise.resolve(fakeBlob) });
      const p = new GoogleDriveAudioProvider({ folderId: 'F', accessToken: 'tok123' });
      const blob = await p.fetchFileBlob('file42');
      expect(blob).toBe(fakeBlob);
      const calledOpts = global.fetch.mock.calls[0][1];
      expect(calledOpts.headers['Authorization']).toBe('Bearer tok123');
    });

    it('includes ?alt=media in the URL', async () => {
      const fakeBlob = new Blob(['data']);
      global.fetch.mockResolvedValue({ ok: true, blob: () => Promise.resolve(fakeBlob) });
      const p = new GoogleDriveAudioProvider({ folderId: 'F' });
      await p.fetchFileBlob('file1');
      const url = global.fetch.mock.calls[0][0];
      expect(url).toContain('?alt=media');
    });

    it('includes apiKey when set', async () => {
      const fakeBlob = new Blob(['data']);
      global.fetch.mockResolvedValue({ ok: true, blob: () => Promise.resolve(fakeBlob) });
      const p = new GoogleDriveAudioProvider({ folderId: 'F', apiKey: 'MYKEY' });
      await p.fetchFileBlob('file1');
      const url = global.fetch.mock.calls[0][0];
      expect(url).toContain('key=MYKEY');
    });

    it('does not include apiKey when none is set', async () => {
      const fakeBlob = new Blob(['data']);
      global.fetch.mockResolvedValue({ ok: true, blob: () => Promise.resolve(fakeBlob) });
      const p = new GoogleDriveAudioProvider({ folderId: 'F' });
      await p.fetchFileBlob('file1');
      const url = global.fetch.mock.calls[0][0];
      expect(url).not.toContain('key=');
    });

    it('does not send Authorization when no accessToken', async () => {
      const fakeBlob = new Blob(['data']);
      global.fetch.mockResolvedValue({ ok: true, blob: () => Promise.resolve(fakeBlob) });
      const p = new GoogleDriveAudioProvider({ folderId: 'F' });
      await p.fetchFileBlob('file1');
      const opts = global.fetch.mock.calls[0][1];
      expect(opts.headers['Authorization']).toBeUndefined();
    });

    it('throws with status code on non-ok response', async () => {
      global.fetch.mockResolvedValue({ ok: false, status: 403 });
      const p = new GoogleDriveAudioProvider({ folderId: 'F' });
      await expect(p.fetchFileBlob('file1')).rejects.toThrow('Drive download error 403');
    });

    it('throws with status 404', async () => {
      global.fetch.mockResolvedValue({ ok: false, status: 404 });
      const p = new GoogleDriveAudioProvider({ folderId: 'F' });
      await expect(p.fetchFileBlob('missing')).rejects.toThrow('Drive download error 404');
    });

    it('uses the correct file ID in the URL', async () => {
      const fakeBlob = new Blob([]);
      global.fetch.mockResolvedValue({ ok: true, blob: () => Promise.resolve(fakeBlob) });
      const p = new GoogleDriveAudioProvider({ folderId: 'F' });
      await p.fetchFileBlob('specific-file-id');
      const url = global.fetch.mock.calls[0][0];
      expect(url).toContain('/files/specific-file-id?');
    });
  });
});