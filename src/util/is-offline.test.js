/** @vitest-environment jsdom */

import { afterEach, describe, it, expect, vi } from "vitest";
import { setFlag } from "../config/feature-flags.js";
import { getMockOffline, isOffline, setMockOffline } from "./is-offline.js";

describe("isOffline", () => {
  afterEach(() => {
    setMockOffline(false);
    vi.unstubAllGlobals();
  });

  it("returns true when MOCK_OFFLINE is enabled", () => {
    setMockOffline(true);
    vi.stubGlobal("navigator", { onLine: true });
    expect(isOffline()).toBe(true);
    expect(getMockOffline()).toBe(true);
  });

  it("returns true when navigator.onLine is false", () => {
    vi.stubGlobal("navigator", { onLine: false });
    expect(isOffline()).toBe(true);
  });

  it("returns false when online and mock is off", () => {
    vi.stubGlobal("navigator", { onLine: true });
    expect(isOffline()).toBe(false);
  });

  it("enables mock offline from ?mockOffline=1 in the URL", () => {
    vi.stubGlobal("location", { search: "?mockOffline=1" });
    vi.resetModules();
    // applyMockOfflineFromUrl runs at module load — re-import fresh module
    return import("./is-offline.js").then(({ isOffline, getMockOffline }) => {
      expect(getMockOffline()).toBe(true);
      expect(isOffline()).toBe(true);
    });
  });
});
