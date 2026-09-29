/**
 * Play queue for the site player: an ordered track list plus the index of the
 * track that is playing. Pure data — no DOM, no audio — so it is easy to test.
 *
 * Items before `index` are history, `current()` is now playing, items after
 * `index` are "up next". Reorder/remove keep the same track playing.
 *
 * @typedef {{ id: string, title: string, artist?: string, artworkUrl?: string | null }} QueueTrack
 */

/**
 * @param {QueueTrack[]} [tracks]
 */
export function createPlayQueue(tracks = []) {
  /** @type {QueueTrack[]} */
  let items = tracks.slice();
  let index = items.length > 0 ? 0 : -1;

  const clampIndex = (i) => Math.max(0, Math.min(items.length - 1, i));
  const indexOfId = (id) => items.findIndex((t) => t.id === id);

  return {
    get items() {
      return items.slice();
    },
    get index() {
      return index;
    },
    get length() {
      return items.length;
    },
    /** @returns {QueueTrack | null} */
    current() {
      return index >= 0 ? items[index] : null;
    },
    /** @returns {QueueTrack[]} tracks after the current one */
    upNext() {
      return index >= 0 ? items.slice(index + 1) : items.slice();
    },

    /**
     * Replace the list. Keeps the current track playing if it is still in the new list.
     * @param {QueueTrack[]} list
     */
    setTracks(list) {
      const keepId = index >= 0 ? items[index].id : null;
      items = list.slice();
      const kept = keepId == null ? -1 : indexOfId(keepId);
      index = kept >= 0 ? kept : items.length > 0 ? 0 : -1;
    },

    /**
     * Advance to the next track. At the end it wraps to the first track unless `wrap` is false.
     * @returns {QueueTrack | null} the new current track, or null at the end (no wrap) / empty
     */
    next({ wrap = true } = {}) {
      if (items.length === 0) return null;
      if (index + 1 < items.length) index += 1;
      else if (wrap) index = 0;
      else return null;
      return items[index];
    },

    /** Go back one track (wraps to the last track from the first). */
    prev() {
      if (items.length === 0) return null;
      index = index - 1 >= 0 ? index - 1 : items.length - 1;
      return items[index];
    },

    /** Make the track with `id` current. Returns it, or null if not queued. */
    jumpTo(id) {
      const i = indexOfId(id);
      if (i < 0) return null;
      index = i;
      return items[index];
    },

    /**
     * Remove a track. If it was playing, the following track becomes current
     * (or the previous one if it was the last).
     * @returns {{ removed: boolean, wasCurrent: boolean }}
     */
    remove(id) {
      const i = indexOfId(id);
      if (i < 0) return { removed: false, wasCurrent: false };
      const wasCurrent = i === index;
      items.splice(i, 1);
      if (items.length === 0) index = -1;
      else if (i < index) index -= 1;
      else if (wasCurrent) index = clampIndex(index);
      return { removed: true, wasCurrent };
    },

    /**
     * Move the item at `from` to `to` (both full-list indices). Current track stays current.
     * @returns {boolean} true if something moved
     */
    move(from, to) {
      if (from < 0 || from >= items.length) return false;
      const target = clampIndex(to);
      if (target === from) return false;
      const currentId = index >= 0 ? items[index].id : null;
      const [item] = items.splice(from, 1);
      items.splice(target, 0, item);
      if (currentId != null) index = indexOfId(currentId);
      return true;
    },

    /** Move a track by `delta` places (e.g. -1 = up). */
    moveBy(id, delta) {
      const i = indexOfId(id);
      return i >= 0 ? this.move(i, i + delta) : false;
    },

    /**
     * Shuffle only the "up next" part; history and the current track stay put.
     * @param {() => number} [rng] returns [0, 1)
     */
    shuffleUpcoming(rng = Math.random) {
      const start = index + 1;
      for (let i = items.length - 1; i > start; i--) {
        const j = start + Math.floor(rng() * (i - start + 1));
        [items[i], items[j]] = [items[j], items[i]];
      }
    },
  };
}

/**
 * Turn a Drive file ({ id, name }) into a queue track: title without the extension
 * or a leading "1. " / "01 - " number.
 * @param {{ id: string, name?: string }} file
 * @returns {QueueTrack}
 */
export function driveFileToTrack(file) {
  const raw = String(file?.name ?? "").trim();
  const noExt = raw.replace(/\.(mp3|m4a|aac|wav|flac|ogg|oga|opus|webm|aiff?)$/i, "");
  const title = noExt.replace(/^\s*\d{1,3}\s*[.)\-–]\s*/, "").trim() || noExt || "Untitled";
  return { id: file.id, title, artist: "NXGRXVITY", artworkUrl: null };
}
