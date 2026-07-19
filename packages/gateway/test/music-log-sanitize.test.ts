import { describe, expect, it } from "vitest";
import { sanitizeMedia } from "../src/music/log-sanitize.js";

describe("sanitizeMedia — media/ffmpeg log cleaning", () => {
  it("masks the query of a GoogleVideo URL but keeps host + path", () => {
    const url =
      "https://rr3---sn-abc.googlevideo.com/videoplayback?expire=1721000000&ei=xyz&ip=1.2.3.4&signature=DEADBEEFSECRET&mime=audio";
    const out = sanitizeMedia(`opening ${url} for reading`);
    expect(out).toContain("rr3---sn-abc.googlevideo.com/videoplayback?[redacted]");
    expect(out).not.toContain("signature=DEADBEEFSECRET");
    expect(out).not.toContain("ip=1.2.3.4");
    expect(out).not.toContain("expire=");
  });

  it("strips embedded user:pass@ credentials from a URL", () => {
    const out = sanitizeMedia("proxy https://user:s3cr3t@proxy.example.com/path?x=1");
    expect(out).not.toContain("s3cr3t");
    expect(out).toContain("proxy.example.com/path?[redacted]");
  });

  it("redacts a Cookie header value (including trailing pairs)", () => {
    const out = sanitizeMedia("Cookie: SID=abcd1234; HSID=efgh5678; SSID=zzz");
    expect(out).toContain("Cookie: [redacted]");
    expect(out).not.toContain("abcd1234");
    expect(out).not.toContain("HSID=efgh5678");
  });

  it("redacts an Authorization header but leaves the label", () => {
    const out = sanitizeMedia("Authorization: Bearer supersecrettokenvalue");
    expect(out).toContain("Authorization: [redacted]");
    expect(out).not.toContain("supersecrettokenvalue");
  });

  it("redacts a Discord-token-shaped string", () => {
    // Assembled from fragments so no literal token lands in source (secret scanners).
    const token = ["MTAxMjM0NTY3ODkwMTIzNDU2Nz", "GaBcDe", "aB1cD2eF3gH4iJ5kL6mN7oP8qR9sT0uV1wX2yZ"].join(".");
    const out = sanitizeMedia(`login with ${token}`);
    expect(out).toContain("[redacted-token]");
    expect(out).not.toContain(token);
  });

  it("keeps the HTTP status code from an ffmpeg error", () => {
    const out = sanitizeMedia("[https @ 0x5580] HTTP error 403 Forbidden");
    expect(out).toContain("403");
    expect(out).toContain("Forbidden");
  });

  it("truncates an over-long message, keeping the tail (where the error is)", () => {
    const long = `${"x".repeat(5000)} HTTP error 403 Forbidden`;
    const out = sanitizeMedia(long, 1000);
    expect(out.length).toBeLessThanOrEqual(1001); // maxLen + the "…" marker
    expect(out.startsWith("…")).toBe(true);
    expect(out).toContain("403 Forbidden"); // tail preserved
  });

  it("collapses newlines into a single bounded log line", () => {
    const out = sanitizeMedia("line one\nline two\r\nline three");
    expect(out).not.toMatch(/[\r\n]/);
    expect(out).toContain("line one | line two | line three");
  });

  it("handles null / undefined without throwing", () => {
    expect(sanitizeMedia(undefined)).toBe("");
    expect(sanitizeMedia(null)).toBe("");
  });
});
