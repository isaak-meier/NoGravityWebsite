import { describe, it, expect } from "vitest";
import { createPlayQueue, driveFileToTrack } from "./play-queue.js";

const t = (id) => ({ id, title: `Track ${id}` });
const ids = (q) => q.items.map((x) => x.id).join("");

describe("createPlayQueue", () => {
  it("starts on the first track; empty queue has no current", () => {
    expect(createPlayQueue([t("a"), t("b")]).current().id).toBe("a");
    const empty = createPlayQueue();
    expect(empty.current()).toBeNull();
    expect(empty.next()).toBeNull();
    expect(empty.prev()).toBeNull();
    expect(empty.upNext()).toEqual([]);
  });

  it("next/prev walk the list and wrap around", () => {
    const q = createPlayQueue([t("a"), t("b"), t("c")]);
    expect(q.next().id).toBe("b");
    expect(q.next().id).toBe("c");
    expect(q.next().id).toBe("a"); // wraps
    expect(q.prev().id).toBe("c"); // wraps back
    expect(q.prev().id).toBe("b");
  });

  it("next({ wrap: false }) stops at the end", () => {
    const q = createPlayQueue([t("a"), t("b")]);
    q.next();
    expect(q.next({ wrap: false })).toBeNull();
    expect(q.current().id).toBe("b");
  });

  it("upNext lists tracks after the current one", () => {
    const q = createPlayQueue([t("a"), t("b"), t("c")]);
    q.jumpTo("b");
    expect(q.upNext().map((x) => x.id)).toEqual(["c"]);
  });

  it("jumpTo makes a track current; unknown id is a no-op", () => {
    const q = createPlayQueue([t("a"), t("b"), t("c")]);
    expect(q.jumpTo("c").id).toBe("c");
    expect(q.jumpTo("zzz")).toBeNull();
    expect(q.current().id).toBe("c");
  });

  it("remove keeps the playing track when removing others", () => {
    const q = createPlayQueue([t("a"), t("b"), t("c"), t("d")]);
    q.jumpTo("c");
    expect(q.remove("a")).toEqual({ removed: true, wasCurrent: false });
    expect(q.current().id).toBe("c");
    q.remove("d");
    expect(q.current().id).toBe("c");
    expect(ids(q)).toBe("bc");
  });

  it("removing the current track moves to the following one (or previous at the end)", () => {
    const q = createPlayQueue([t("a"), t("b"), t("c")]);
    q.jumpTo("b");
    expect(q.remove("b").wasCurrent).toBe(true);
    expect(q.current().id).toBe("c");
    q.remove("c");
    expect(q.current().id).toBe("a");
    q.remove("a");
    expect(q.current()).toBeNull();
    expect(q.index).toBe(-1);
  });

  it("remove of an unknown id reports nothing removed", () => {
    const q = createPlayQueue([t("a")]);
    expect(q.remove("x")).toEqual({ removed: false, wasCurrent: false });
  });

  it("move reorders and keeps the same track playing", () => {
    const q = createPlayQueue([t("a"), t("b"), t("c"), t("d")]);
    q.jumpTo("b");
    expect(q.move(3, 2)).toBe(true); // d before c
    expect(ids(q)).toBe("abdc");
    expect(q.current().id).toBe("b");
    q.move(1, 3); // move the playing track itself
    expect(ids(q)).toBe("adcb");
    expect(q.current().id).toBe("b");
    expect(q.move(0, 0)).toBe(false);
    expect(q.move(9, 0)).toBe(false);
  });

  it("move clamps the target into range", () => {
    const q = createPlayQueue([t("a"), t("b"), t("c")]);
    q.move(0, 99);
    expect(ids(q)).toBe("bca");
    expect(q.current().id).toBe("a");
  });

  it("moveBy moves a track up/down by id", () => {
    const q = createPlayQueue([t("a"), t("b"), t("c")]);
    q.moveBy("c", -1);
    expect(ids(q)).toBe("acb");
    expect(q.moveBy("nope", 1)).toBe(false);
  });

  it("shuffleUpcoming never touches history or the current track", () => {
    const q = createPlayQueue(["a", "b", "c", "d", "e", "f"].map(t));
    q.jumpTo("c");
    let seed = 7;
    const rng = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    q.shuffleUpcoming(rng);
    expect(q.items.slice(0, 3).map((x) => x.id)).toEqual(["a", "b", "c"]);
    expect(q.current().id).toBe("c");
    expect(q.upNext().map((x) => x.id).sort()).toEqual(["d", "e", "f"]);
  });

  it("next after shuffle follows the shuffled order", () => {
    const q = createPlayQueue(["a", "b", "c"].map(t));
    q.shuffleUpcoming(() => 0); // deterministic swap
    const order = q.upNext().map((x) => x.id);
    expect(q.next().id).toBe(order[0]);
  });

  it("setTracks keeps the playing track if it is still listed", () => {
    const q = createPlayQueue([t("a"), t("b")]);
    q.jumpTo("b");
    q.setTracks([t("x"), t("b"), t("y")]);
    expect(q.current().id).toBe("b");
    q.setTracks([t("z")]);
    expect(q.current().id).toBe("z");
    q.setTracks([]);
    expect(q.current()).toBeNull();
  });

  it("items is a copy (callers can't break the queue)", () => {
    const q = createPlayQueue([t("a")]);
    q.items.push(t("b"));
    expect(q.length).toBe(1);
  });
});

describe("driveFileToTrack", () => {
  it("strips extension and leading track numbers", () => {
    expect(driveFileToTrack({ id: "1", name: "1. abridged.mp3" }).title).toBe("abridged");
    expect(driveFileToTrack({ id: "2", name: "03 - Make You Mine (NXGRXVITY Edit).wav" }).title)
      .toBe("Make You Mine (NXGRXVITY Edit)");
    expect(driveFileToTrack({ id: "3", name: "planet cool.m4a" }).title).toBe("planet cool");
  });

  it("keeps the id, sets the artist, and never returns an empty title", () => {
    const tr = driveFileToTrack({ id: "x", name: "" });
    expect(tr).toMatchObject({ id: "x", artist: "NXGRXVITY", title: "Untitled" });
  });
});
