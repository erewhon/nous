import { describe, expect, it } from "vitest";
import { extToContentType } from "./contentType";

describe("extToContentType", () => {
  it("maps common extensions to the right MIME type", () => {
    expect(extToContentType("index.html")).toBe("text/html; charset=utf-8");
    expect(extToContentType("styles/app.css")).toBe("text/css; charset=utf-8");
    expect(extToContentType("bundle.js")).toBe("text/javascript; charset=utf-8");
    expect(extToContentType("data.json")).toBe("application/json; charset=utf-8");
    expect(extToContentType("logo.svg")).toBe("image/svg+xml");
    expect(extToContentType("pic.png")).toBe("image/png");
    expect(extToContentType("pic.jpeg")).toBe("image/jpeg");
    expect(extToContentType("font.woff2")).toBe("font/woff2");
  });

  it("is case-insensitive on the extension", () => {
    expect(extToContentType("INDEX.HTML")).toBe(extToContentType("index.html"));
    expect(extToContentType("Photo.JPG")).toBe("image/jpeg");
  });

  it("falls back to octet-stream for unknown or missing extensions", () => {
    expect(extToContentType("archive.bin")).toBe("application/octet-stream");
    expect(extToContentType("noextension")).toBe("application/octet-stream");
    expect(extToContentType("trailingdot.")).toBe("application/octet-stream");
    expect(extToContentType("")).toBe("application/octet-stream");
  });

  it("uses the last path segment so dotted directories don't confuse it", () => {
    expect(extToContentType("assets/v1.2/app.css")).toBe("text/css; charset=utf-8");
    expect(extToContentType("some.dir/plainfile")).toBe("application/octet-stream");
  });
});
