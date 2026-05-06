/** @vitest-environment jsdom */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { createPlanetMailingPanel } from "./planet-mailing-panel.js";

beforeEach(() => { document.body.innerHTML = ""; });

const baseConfig = {
  mailingList: { emailFieldName: "EMAIL" },
  api: { baseUrl: "https://api.example.com" },
};

describe("planet-mailing-panel", () => {
  it("throws if api.baseUrl is null", () => {
    expect(() =>
      createPlanetMailingPanel({
        mailingList: {},
        api: { baseUrl: null },
      }),
    ).toThrow(/api\.baseUrl is required/i);
  });

  it("throws if api.baseUrl is missing / whitespace-only", () => {
    expect(() =>
      createPlanetMailingPanel({
        mailingList: {},
        api: { baseUrl: "   " },
      }),
    ).toThrow(/api\.baseUrl is required/i);
    expect(() =>
      createPlanetMailingPanel({
        mailingList: {},
        api: {},
      }),
    ).toThrow(/api\.baseUrl is required/i);
  });

  it("renders the title, email input, and submit button", () => {
    const panel = createPlanetMailingPanel(baseConfig);
    document.body.appendChild(panel.root);
    expect(panel.root.querySelector(".planet-mailing-panel__title").textContent)
      .toMatch(/sign up/i);
    expect(panel.root.querySelector('input[type="email"]')).toBeTruthy();
    expect(panel.root.querySelector('button[type="submit"]').textContent).toBe("Sign up");
  });

  it("setInsidePlanet toggles the visibility class + aria-hidden", () => {
    const panel = createPlanetMailingPanel(baseConfig);
    panel.setInsidePlanet(true);
    expect(panel.root.classList.contains("planet-mailing-panel--visible")).toBe(true);
    expect(panel.root.getAttribute("aria-hidden")).toBe("false");
    panel.setInsidePlanet(false);
    expect(panel.root.classList.contains("planet-mailing-panel--visible")).toBe(false);
    expect(panel.root.getAttribute("aria-hidden")).toBe("true");
  });

  it("submit POSTs JSON to /api/subscribe and shows success", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      headers: { get: () => "application/json" },
      text: async () => "{}",
    }));
    const panel = createPlanetMailingPanel(baseConfig, { fetchImpl });
    document.body.appendChild(panel.root);
    const input = panel.root.querySelector('input[type="email"]');
    const form = panel.root.querySelector("form");
    input.value = "alice@example.com";
    form.dispatchEvent(new Event("submit"));
    await new Promise((r) => setTimeout(r, 0));

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://api.example.com/api/subscribe");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ email: "alice@example.com", hp: "" });
    const status = panel.root.querySelector(".planet-mailing-panel__status");
    expect(status.hidden).toBe(false);
    expect(status.textContent).toMatch(/check your inbox/i);
    expect(input.value).toBe("");
  });

  it("server error shows an error status", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: false,
      status: 500,
      headers: { get: () => "" },
      text: async () => "",
    }));
    const panel = createPlanetMailingPanel(baseConfig, { fetchImpl });
    document.body.appendChild(panel.root);
    panel.root.querySelector('input[type="email"]').value = "a@b.c";
    panel.root.querySelector("form").dispatchEvent(new Event("submit"));
    await new Promise((r) => setTimeout(r, 0));
    const status = panel.root.querySelector(".planet-mailing-panel__status");
    expect(status.hidden).toBe(false);
    expect(status.textContent).toMatch(/500|fail|request failed/i);
  });
});
