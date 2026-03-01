/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import GoogleDriveAudioProvider from './google-drive-audio.js';

describe('GoogleDriveAudioProvider', () => {
  beforeEach(() => {
    global.fetch = vi.fn();
  });

  it('requires folderId', () => {
    expect(() => new GoogleDriveAudioProvider()).toThrow();
  });

  it('builds download URL correctly with apiKey', () => {
    const prov = new GoogleDriveAudioProvider({ folderId: 'abc', apiKey: 'KEY' });
    expect(prov.getDownloadUrl('file1')).toBe(
      'https://www.googleapis.com/drive/v3/files/file1?alt=media&key=KEY'
    );
  });

  it('listFiles calls fetch with correct query', async () => {
    const fakeResp = { files: [{ id: '1', name: 'a.mp3', mimeType: 'audio/mpeg' }] };
    global.fetch.mockResolvedValue({ ok: true, json: () => Promise.resolve(fakeResp) });
    const prov = new GoogleDriveAudioProvider({ folderId: 'FOLDER', apiKey: 'K' });
    const files = await prov.listFiles();
    expect(files).toEqual(fakeResp.files);
    const calledUrl = global.fetch.mock.calls[0][0];
    expect(calledUrl).toContain("%27FOLDER%27%2Bin%2Bparents");
    expect(calledUrl).toContain('key=K');
  });

  it('listFiles throws when fetch not ok', async () => {
    global.fetch.mockResolvedValue({ ok: false, status: 500, json: () => Promise.resolve({}) });
    const prov = new GoogleDriveAudioProvider({ folderId: 'F' });
    await expect(prov.listFiles()).rejects.toThrow();
  });
});