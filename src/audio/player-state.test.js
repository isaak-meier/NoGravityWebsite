import { describe, it, expect } from "vitest";
import {
  formatTime,
  clampSeek,
  fractionToTime,
  progressFraction,
  clampVolume,
  prevAction,
  playerStatus,
  keyToPlayerAction,
} from "./player-state.js";

describe("player-state helpers", () => {
  it("formatTime", () => {
    expect(formatTime(0)).toBe("0:00");
    expect(formatTime(7.9)).toBe("0:07");
    expect(formatTime(181)).toBe("3:01");
    expect(formatTime(3725)).toBe("1:02:05");
    expect(formatTime(NaN)).toBe("0:00");
    expect(formatTime(-3)).toBe("0:00");
    expect(formatTime(Infinity)).toBe("0:00");
  });

  it("clampSeek keeps seeks inside the track", () => {
    expect(clampSeek(-5, 100)).toBe(0);
    expect(clampSeek(150, 100)).toBe(100);
    expect(clampSeek(42, 100)).toBe(42);
    expect(clampSeek(42, NaN)).toBe(42); // unknown duration: only clamp at 0
    expect(clampSeek(NaN, 100)).toBe(0);
  });

  it("fractionToTime / progressFraction", () => {
    expect(fractionToTime(0.5, 200)).toBe(100);
    expect(fractionToTime(2, 200)).toBe(200);
    expect(fractionToTime(0.5, 0)).toBe(0);
    expect(progressFraction(50, 200)).toBe(0.25);
    expect(progressFraction(500, 200)).toBe(1);
    expect(progressFraction(5, NaN)).toBe(0);
  });

  it("clampVolume", () => {
    expect(clampVolume(0.4)).toBe(0.4);
    expect(clampVolume(4)).toBe(1);
    expect(clampVolume(-1)).toBe(0);
    expect(clampVolume("0.25")).toBe(0.25);
    expect(clampVolume("junk")).toBe(1);
  });

  it("prevAction restarts after 3 s, otherwise goes back", () => {
    expect(prevAction(10)).toBe("restart");
    expect(prevAction(1)).toBe("previous");
    expect(prevAction(NaN)).toBe("previous");
  });

  it("playerStatus", () => {
    expect(playerStatus({ loading: true, hasAudio: true })).toBe("loading");
    expect(playerStatus({ error: true })).toBe("error");
    expect(playerStatus({ hasAudio: false })).toBe("idle");
    expect(playerStatus({ hasAudio: true, paused: true })).toBe("paused");
    expect(playerStatus({ hasAudio: true, paused: false })).toBe("playing");
  });
});

describe("keyToPlayerAction", () => {
  const body = { tagName: "BODY", getAttribute: () => null };
  it("space toggles, arrows seek", () => {
    expect(keyToPlayerAction({ key: " ", target: body })).toBe("toggle");
    expect(keyToPlayerAction({ key: "ArrowLeft", target: body })).toBe("seekBack");
    expect(keyToPlayerAction({ key: "ArrowRight", target: body })).toBe("seekForward");
    expect(keyToPlayerAction({ key: "w", target: body })).toBeNull();
  });

  it("ignores typing fields, sliders, focused buttons and modifier combos", () => {
    expect(keyToPlayerAction({ key: " ", target: { tagName: "INPUT", getAttribute: () => null } })).toBeNull();
    expect(keyToPlayerAction({ key: "ArrowLeft", target: { tagName: "DIV", getAttribute: () => "slider" } })).toBeNull();
    expect(keyToPlayerAction({ key: " ", target: { tagName: "BUTTON", getAttribute: () => null } })).toBeNull();
    expect(keyToPlayerAction({ key: "ArrowRight", target: body, metaKey: true })).toBeNull();
    expect(keyToPlayerAction({ key: " ", target: body, defaultPrevented: true })).toBeNull();
  });
});
