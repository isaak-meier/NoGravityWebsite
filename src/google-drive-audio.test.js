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

  it('getFolder returns current folder metadata', async () => {
    const fakeResp = { id: 'FOLDER_ID', name: 'My Folder' };
    global.fetch.mockResolvedValue({ ok: true, json: () => Promise.resolve(fakeResp) });
    const prov = new GoogleDriveAudioProvider({ folderId: 'FOLDER_ID', accessToken: 'token' });
    const folder = await prov.getFolder();
    expect(folder).toEqual(fakeResp);
    const calledUrl = global.fetch.mock.calls[0][0];
    expect(calledUrl).toContain('/drive/v3/files/FOLDER_ID');
    expect(calledUrl).toContain('fields=id%2Cname');
  });

  it('fetchFileBlob fetches file content as blob with auth', async () => {
    const fakeBlob = new Blob(['audio-data'], { type: 'audio/mpeg' });
    global.fetch.mockResolvedValue({ ok: true, blob: () => Promise.resolve(fakeBlob) });
    const prov = new GoogleDriveAudioProvider({ folderId: 'F', accessToken: 'tok123' });
    const blob = await prov.fetchFileBlob('file42');
    expect(blob).toBe(fakeBlob);
    const calledUrl = global.fetch.mock.calls[0][0];
    expect(calledUrl).toContain('/drive/v3/files/file42?alt=media');
    const calledOpts = global.fetch.mock.calls[0][1];
    expect(calledOpts.headers['Authorization']).toBe('Bearer tok123');
  });

  it('fetchFileBlob includes apiKey when set', async () => {
    const fakeBlob = new Blob(['data']);
    global.fetch.mockResolvedValue({ ok: true, blob: () => Promise.resolve(fakeBlob) });
    const prov = new GoogleDriveAudioProvider({ folderId: 'F', apiKey: 'MYKEY' });
    await prov.fetchFileBlob('file1');
    const calledUrl = global.fetch.mock.calls[0][0];
    expect(calledUrl).toContain('key=MYKEY');
  });

  it('fetchFileBlob throws on non-ok response', async () => {
    global.fetch.mockResolvedValue({ ok: false, status: 403 });
    const prov = new GoogleDriveAudioProvider({ folderId: 'F' });
    await expect(prov.fetchFileBlob('file1')).rejects.toThrow('Drive download error 403');
  });
});