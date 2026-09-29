/** @vitest-environment jsdom */

import { afterEach, describe, it, expect, vi } from "vitest";
import { _resetCockpitToastForTests, showCockpitToast } from "./cockpit-toast.js";

describe("showCockpitToast", () => {
  afterEach(() => {
    vi.useRealTimers();
    _resetCockpitToastForTests();
  });

  it("appends a styled toast to the document", () => {
    showCockpitToast("You're offline");
    const toast = document.querySelector(".cockpit-toast");
    expect(toast?.textContent).toBe("You're offline");
    expect(document.querySelector(".cockpit-toast-host")).toBeTruthy();
  });

  it("removes the toast after the duration", () => {
    vi.useFakeTimers();
    showCockpitToast("Gone soon", { durationMs: 1000 });
    expect(document.querySelector(".cockpit-toast")).toBeTruthy();
    vi.advanceTimersByTime(1000);
    expect(document.querySelector(".cockpit-toast")).toBeFalsy();
  });

  it("no-ops on empty or missing message", () => {
    showCockpitToast("");
    showCockpitToast(/** @type {string} */ (null));
    expect(document.querySelector(".cockpit-toast-host")).toBeFalsy();
  });

  it("reuses a single host element across calls", () => {
    showCockpitToast("First");
    const host = document.querySelector(".cockpit-toast-host");
    showCockpitToast("Second");
    expect(document.querySelectorAll(".cockpit-toast-host")).toHaveLength(1);
    expect(host?.querySelector(".cockpit-toast")?.textContent).toBe("Second");
  });

  it("replaces prior toast and resets hide timer on rapid calls", () => {
    vi.useFakeTimers();
    showCockpitToast("First", { durationMs: 5000 });
    vi.advanceTimersByTime(4000);
    showCockpitToast("Second", { durationMs: 1000 });
    expect(document.querySelector(".cockpit-toast")?.textContent).toBe("Second");
    vi.advanceTimersByTime(999);
    expect(document.querySelector(".cockpit-toast")).toBeTruthy();
    vi.advanceTimersByTime(1);
    expect(document.querySelector(".cockpit-toast")).toBeFalsy();
  });

  it("sets accessibility attributes on host and toast", () => {
    showCockpitToast("Status");
    const host = document.querySelector(".cockpit-toast-host");
    const toast = document.querySelector(".cockpit-toast");
    expect(host?.getAttribute("aria-live")).toBe("polite");
    expect(toast?.getAttribute("role")).toBe("status");
  });

  it("no-ops when document is unavailable", () => {
    const doc = globalThis.document;
    // @ts-expect-error simulate non-browser environment
    delete globalThis.document;
    expect(() => showCockpitToast("Nope")).not.toThrow();
    globalThis.document = doc;
  });

  it("_resetCockpitToastForTests clears host and pending timer", () => {
    vi.useFakeTimers();
    showCockpitToast("Pending", { durationMs: 10000 });
    _resetCockpitToastForTests();
    expect(document.querySelector(".cockpit-toast-host")).toBeFalsy();
    vi.advanceTimersByTime(10000);
    expect(document.querySelector(".cockpit-toast")).toBeFalsy();
  });
});
