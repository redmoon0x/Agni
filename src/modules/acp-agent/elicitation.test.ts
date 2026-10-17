import {
  defaultElicitationValues,
  elicitationContent,
  parseElicitationRequest,
} from "@/modules/acp-agent/elicitation";
import { describe, expect, it } from "vitest";

const params = {
  mode: "form",
  message: "Choose how to continue.",
  requestedSchema: {
    type: "object",
    title: "A question",
    required: ["strategy", "count"],
    properties: {
      strategy: {
        type: "string",
        title: "Strategy",
        oneOf: [
          { const: "safe", title: "Safe" },
          { const: "fast", title: "Fast", description: "Use the quick route." },
        ],
      },
      count: { type: "integer", title: "Count" },
      enabled: { type: "boolean", title: "Enabled", default: true },
    },
  },
};

describe("ACP elicitation", () => {
  it("parses supported form fields and their defaults", () => {
    const request = parseElicitationRequest(4, params);
    expect(request).toEqual(
      expect.objectContaining({
        mode: "form",
        id: 4,
        title: "A question",
        fields: expect.arrayContaining([
          expect.objectContaining({ name: "strategy", type: "select", required: true }),
          expect.objectContaining({ name: "count", type: "integer", required: true }),
          expect.objectContaining({ name: "enabled", type: "boolean" }),
        ]),
      }),
    );
    const fields = request?.mode === "form" ? request.fields : [];
    expect(defaultElicitationValues(fields)).toEqual({
      strategy: "",
      count: "",
      enabled: true,
    });
  });

  it("validates required values and converts numeric fields", () => {
    const request = parseElicitationRequest(4, params);
    expect(request?.mode).toBe("form");
    const fields = request?.mode === "form" ? request.fields : [];
    expect(elicitationContent(fields, { strategy: "string:safe", count: "3", enabled: false })).toEqual({
      strategy: "safe",
      count: 3,
      enabled: false,
    });
    expect(elicitationContent(fields, { strategy: "", count: "3", enabled: false })).toBeNull();
    expect(elicitationContent(fields, { strategy: "string:safe", count: "no", enabled: false })).toBeNull();
  });

  it("parses URL mode and rejects unsafe or incomplete requests", () => {
    expect(
      parseElicitationRequest(12, {
        mode: "url",
        message: "Authorize access to your repositories.",
        elicitationId: "github-oauth-001",
        url: "https://agent.example.com/connect",
      }),
    ).toEqual({
      mode: "url",
      id: 12,
      scope: null,
      message: "Authorize access to your repositories.",
      title: null,
      url: "https://agent.example.com/connect",
      elicitationId: "github-oauth-001",
    });
    expect(
      parseElicitationRequest(12, {
        mode: "url",
        message: "No URL",
      }),
    ).toBeNull();
    expect(
      parseElicitationRequest(12, {
        mode: "url",
        message: "Bad scheme",
        url: "file:///tmp/oauth",
      }),
    ).toBeNull();
  });

  it("preserves unknown modes instead of rejecting them", () => {
    const request = parseElicitationRequest(1, { ...params, mode: "_acme" });
    expect(request).toEqual(
      expect.objectContaining({
        mode: "other",
        id: 1,
        rawMode: "_acme",
        message: "Choose how to continue.",
      }),
    );
    if (request?.mode !== "other") throw new Error("expected an opaque mode");
    expect(request.value.mode).toBe("_acme");
  });

  it("renders structured fields through a json editor", () => {
    const request = parseElicitationRequest(1, {
      ...params,
      requestedSchema: {
        ...params.requestedSchema,
        required: ["nested"],
        properties: { nested: { type: "object", title: "Nested" } },
      },
    });
    const fields = request?.mode === "form" ? request.fields : [];
    expect(fields[0]).toMatchObject({ name: "nested", type: "json" });
    expect(elicitationContent(fields, { nested: '{"a":1}' })).toEqual({
      nested: { a: 1 },
    });
    expect(elicitationContent(fields, { nested: "nope" })).toBeNull();
  });

  it("renders enumerated arrays as a multiselect", () => {
    const request = parseElicitationRequest(1, {
      mode: "form",
      message: "Pick tools.",
      requestedSchema: {
        type: "object",
        required: ["tools"],
        properties: {
          tools: {
            type: "array",
            title: "Tools",
            default: ["read"],
            items: { type: "string", enum: ["read", "write"] },
          },
        },
      },
    });
    const fields = request?.mode === "form" ? request.fields : [];
    expect(fields[0]).toMatchObject({ name: "tools", type: "multiselect" });
    expect(defaultElicitationValues(fields)).toEqual({ tools: ["string:read"] });
    expect(
      elicitationContent(fields, { tools: ["string:read", "string:write"] }),
    ).toEqual({ tools: ["read", "write"] });
    expect(elicitationContent(fields, { tools: [] })).toBeNull();
  });

  it("anchors to a session or to a bare request id", () => {
    expect(
      parseElicitationRequest(1, {
        ...params,
        sessionId: "s1",
        toolCallId: "call-1",
      }),
    ).toMatchObject({
      scope: { kind: "session", sessionId: "s1", toolCallId: "call-1" },
    });
    expect(parseElicitationRequest(1, { ...params, requestId: 77 })).toMatchObject(
      { scope: { kind: "request", requestId: 77 } },
    );
  });
});
