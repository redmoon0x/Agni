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
        id: 4,
        title: "A question",
        fields: expect.arrayContaining([
          expect.objectContaining({ name: "strategy", type: "select", required: true }),
          expect.objectContaining({ name: "count", type: "integer", required: true }),
          expect.objectContaining({ name: "enabled", type: "boolean" }),
        ]),
      }),
    );
    expect(defaultElicitationValues(request?.fields ?? [])).toEqual({
      strategy: "",
      count: "",
      enabled: true,
    });
  });

  it("validates required values and converts numeric fields", () => {
    const request = parseElicitationRequest(4, params);
    expect(request).not.toBeNull();
    const fields = request?.fields ?? [];
    expect(elicitationContent(fields, { strategy: "string:safe", count: "3", enabled: false })).toEqual({
      strategy: "safe",
      count: 3,
      enabled: false,
    });
    expect(elicitationContent(fields, { strategy: "", count: "3", enabled: false })).toBeNull();
    expect(elicitationContent(fields, { strategy: "string:safe", count: "no", enabled: false })).toBeNull();
  });

  it("rejects unsupported modes and field schemas", () => {
    expect(parseElicitationRequest(1, { ...params, mode: "url" })).toBeNull();
    expect(
      parseElicitationRequest(1, {
        ...params,
        requestedSchema: {
          ...params.requestedSchema,
          properties: { nested: { type: "object" } },
        },
      }),
    ).toBeNull();
  });
});
