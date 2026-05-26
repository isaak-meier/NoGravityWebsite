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
    const host = document.querySelector(".cockpit-toast-host");
    expect(host).toBeTruthy();
    expect(host?.getAttribute("aria-label")).toBe("Notifications");
  });

  it("removes the toast after the duration", () => {
    vi.useFakeTimers();
    showCockpitToast("Gone soon", { durationMs: 1000 });
    expect(document.querySelector(".cockpit-toast")).toBeTruthy();
    vi.advanceTimersByTime(1000);
    expect(document.querySelector(".cockpit-toast")).toBeFalsy();
  });
});
