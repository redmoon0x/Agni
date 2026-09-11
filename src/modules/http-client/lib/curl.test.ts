import { describe, expect, it } from "vitest";
import { importCurl, parseCurl } from "./curl";

describe("parseCurl", () => {
  it("parses a basic GET", () => {
    expect(parseCurl("curl https://api.example.com/todos/1")).toEqual({
      method: "GET",
      url: "https://api.example.com/todos/1",
      headers: [],
      body: "",
    });
  });

  it("parses method, headers and data", () => {
    const result = parseCurl(
      `curl -X POST https://api.example.com/items -H "Content-Type: application/json" -d '{"name":"widget"}'`,
    );
    expect(result?.method).toBe("POST");
    expect(result?.url).toBe("https://api.example.com/items");
    expect(result?.headers).toEqual([
      { name: "Content-Type", value: "application/json" },
    ]);
    expect(result?.body).toBe('{"name":"widget"}');
  });

  it("uses --request with long flags", () => {
    const result = parseCurl(
      `curl --request PUT --header 'Accept: application/json' --data-raw '{"a":1}' https://api.example.com/thing`,
    );
    expect(result?.method).toBe("PUT");
    expect(result?.headers).toEqual([
      { name: "Accept", value: "application/json" },
    ]);
    expect(result?.body).toBe('{"a":1}');
  });

  it("parses --data-json and defaults method to POST", () => {
    const result = parseCurl(
      `curl https://api.example.com/login --data-json '{"user":"a"}'`,
    );
    expect(result?.method).toBe("POST");
    expect(result?.body).toBe('{"user":"a"}');
  });

  it("handles -u user:pass as Basic auth header", () => {
    const result = parseCurl(
      "curl -u admin:secret https://api.example.com/private",
    );
    expect(result?.headers).toEqual([
      { name: "Authorization", value: `Basic ${btoa("admin:secret")}` },
    ]);
  });

  it("turns -d into query params with -G", () => {
    const result = parseCurl(
      "curl -G https://api.example.com/search -d 'q=hello' -d 'page=2'",
    );
    expect(result?.method).toBe("GET");
    expect(result?.url).toBe("https://api.example.com/search?q=hello&page=2");
    expect(result?.body).toBe("");
  });

  it("parses -I as HEAD", () => {
    const result = parseCurl("curl -I https://api.example.com");
    expect(result?.method).toBe("HEAD");
  });

  it("skips output/cookie/referer flags and their values", () => {
    const result = parseCurl(
      'curl -s -o /dev/null -b "sid=abc" https://api.example.com -H "X-Trace: 1"',
    );
    expect(result?.url).toBe("https://api.example.com");
    expect(result?.headers).toEqual([{ name: "X-Trace", value: "1" }]);
  });

  it("returns null without a URL", () => {
    expect(parseCurl("-X GET -H 'X: 1'")).toBeNull();
    expect(parseCurl("")).toBeNull();
  });

  it("keeps only the first non-flag token as URL", () => {
    const result = parseCurl(
      "curl --location https://a.example https://b.example",
    );
    expect(result?.url).toBe("https://a.example");
  });
});

describe("importCurl", () => {
  it("accepts a command with the curl prefix", () => {
    expect(importCurl('curl "https://api.example.com" -H "A: b"')?.url).toBe(
      "https://api.example.com",
    );
  });

  it("accepts curl.exe on windows", () => {
    const result = importCurl(
      "curl.exe -X DELETE https://api.example.com/items/3",
    );
    expect(result?.method).toBe("DELETE");
    expect(result?.url).toBe("https://api.example.com/items/3");
  });

  it("accepts a command without the prefix", () => {
    expect(importCurl("https://api.example.com")?.url).toBe(
      "https://api.example.com",
    );
  });

  it("returns null for empty input", () => {
    expect(importCurl("")).toBeNull();
    expect(importCurl("   ")).toBeNull();
  });

  it("handles backslash continuations", () => {
    const result = importCurl(
      "curl https://api.example.com \\\n  -H 'X-A: 1' \\\n  -d '{}'",
    );
    expect(result?.url).toBe("https://api.example.com");
    expect(result?.headers).toEqual([{ name: "X-A", value: "1" }]);
    expect(result?.body).toBe("{}");
  });
});
