import { describe, it, expect } from "vitest";
import { buildConfig } from "../src/config.js";

describe("buildConfig browser origins", () => {
  it("expands apex SITE_URL to include www for CORS + origin hook", () => {
    const c = buildConfig({
      NODE_ENV: "test",
      SITE_URL: "https://nxgrxvity.com",
      PUBLIC_BASE_URL: "https://api.nxgrxvity.com",
      CORS_ORIGINS: "https://nxgrxvity.com",
      DB_PATH: ":memory:",
      MAIL_TRANSPORT: "noop",
    });
    expect(c.cors.origins).toContain("https://nxgrxvity.com");
    expect(c.cors.origins).toContain("https://www.nxgrxvity.com");
  });

  it("does not synthesize www for localhost", () => {
    const c = buildConfig({
      NODE_ENV: "test",
      SITE_URL: "http://localhost:3000",
      PUBLIC_BASE_URL: "http://127.0.0.1:8787",
      CORS_ORIGINS: "http://localhost:3000",
      DB_PATH: ":memory:",
      MAIL_TRANSPORT: "noop",
    });
    expect(c.cors.origins).toContain("http://localhost:3000");
    expect(c.cors.origins.some((o) => o.includes("www.localhost"))).toBe(false);
  });
});
