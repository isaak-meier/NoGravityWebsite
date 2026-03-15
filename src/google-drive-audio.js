// Minimal wrapper around Google Drive API to expose audio file URLs from a folder

export class GoogleDriveAudioProvider {
  /**
   * @param {Object} opts
   * @param {string} opts.folderId - the ID of the Drive folder containing audio
   * @param {string} [opts.apiKey] - API key (optional if using accessToken)
   * @param {string} [opts.accessToken] - OAuth Bearer token for private folders
   */
  constructor({ folderId, apiKey = null, accessToken = null } = {}) {
    if (!folderId) throw new Error('folderId is required');
    this.folderId = folderId;
    this.apiKey = apiKey;
    this.accessToken = accessToken;
  }

  _fetch(url) {
    const headers = {};
    if (this.accessToken) {
      headers['Authorization'] = `Bearer ${this.accessToken}`;
    }
    return fetch(url, { headers }).then((r) => {
      if (!r.ok) throw new Error(`Drive API error ${r.status}`);
      return r.json();
    });
  }

  /**
   * List audio files in the folder.
   * Returns an array of objects { id, name, mimeType }
   */
  async listFiles() {
    const q = `'${this.folderId}'+in+parents+and+(mimeType contains 'audio/')`;
    const params = new URLSearchParams({
      q,
      fields: 'files(id,name,mimeType)',
      orderBy: 'name_natural',
    });
    if (this.apiKey) params.append('key', this.apiKey);
    const url = `https://www.googleapis.com/drive/v3/files?${params.toString()}`;
    const data = await this._fetch(url);
    return data.files || [];
  }

  /**
   * Get metadata for the current folder.
   * Returns { id, name }.
   */
  async getFolder() {
    const params = new URLSearchParams({
      fields: 'id,name',
    });
    if (this.apiKey) params.append('key', this.apiKey);
    const url = `https://www.googleapis.com/drive/v3/files/${this.folderId}?${params.toString()}`;
    return this._fetch(url);
  }

  /**
   * Get a download URL for a given file ID.
   * Note: you can append &key=<apiKey> if using API key.
   */
  getDownloadUrl(fileId) {
    let url = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`;
    if (this.apiKey) url += `&key=${this.apiKey}`;
    return url;
  }

  /**
   * Fetch a file's content as a Blob with proper auth headers.
   * This is needed because <audio> elements can't send Authorization headers,
   * so we fetch the binary data and create a blob URL instead.
   * @param {string} fileId
   * @returns {Promise<Blob>}
   */
  async fetchFileBlob(fileId) {
    let url = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`;
    if (this.apiKey) url += `&key=${this.apiKey}`;
    const headers = {};
    if (this.accessToken) {
      headers['Authorization'] = `Bearer ${this.accessToken}`;
    }
    const resp = await fetch(url, { headers });
    if (!resp.ok) throw new Error(`Drive download error ${resp.status}`);
    return resp.blob();
  }
}

export default GoogleDriveAudioProvider;
