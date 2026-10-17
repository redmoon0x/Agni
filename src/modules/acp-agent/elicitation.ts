import type {
  AcpElicitationChoice,
  AcpElicitationField,
  AcpElicitationFieldType,
  AcpElicitationRequest,
  AcpElicitationScope,
} from "@/modules/acp-agent/types";

type JsonObject = Record<string, unknown>;

/** Values an elicitation field can carry. `json` covers structured arrays and
 *  objects that have no dedicated editor. */
export type AcpElicitationValue = string | number | boolean | AcpElicitationValue[];
export type AcpElicitationValues = Record<
  string,
  string | boolean | string[] | undefined
>;

function asObject(value: unknown): JsonObject | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function isPrimitive(
  value: unknown,
): value is string | number | boolean {
  return (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  );
}

function choiceId(value: string | number | boolean): string {
  return `${typeof value}:${String(value)}`;
}

function primitiveChoices(value: unknown): AcpElicitationChoice[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) =>
    isPrimitive(item)
      ? [{ id: choiceId(item), value: item, name: String(item) }]
      : [],
  );
}

/** Accepts a bare primitive array or a JSON Schema `enum`. */
function parseChoices(value: unknown): AcpElicitationChoice[] {
  const direct = primitiveChoices(value);
  if (direct.length > 0) return direct;
  const schema = asObject(value);
  const enumValues = primitiveChoices(schema?.enum);
  if (enumValues.length > 0) return enumValues;
  const oneOf = schema && Array.isArray(schema.oneOf) ? schema.oneOf : [];
  return oneOf.flatMap((item) => {
    const option = asObject(item);
    if (!option) return [];
    const value = option.const;
    if (!isPrimitive(value)) return [];
    return [
      {
        id: choiceId(value),
        value,
        name: asString(option.title) ?? String(value),
        description: asString(option.description) ?? undefined,
      },
    ];
  });
}

function defaultPrimitive(
  value: unknown,
): string | number | boolean | (string | number | boolean)[] | undefined {
  if (isPrimitive(value)) return value;
  if (Array.isArray(value)) {
    const items = value.filter(isPrimitive);
    return items.length > 0 ? items : undefined;
  }
  return undefined;
}

function parseField(
  name: string,
  value: unknown,
  required: Set<string>,
): AcpElicitationField | null {
  const schema = asObject(value);
  if (!schema) return null;
  const type = asString(schema.type);

  if (type === "array") {
    const items = asObject(schema.items);
    const choices = parseChoices(items ?? schema);
    // Only enumerated arrays get a real control; free-form arrays fall back to
    // a JSON editor rather than being rejected.
    const resolved: AcpElicitationFieldType = choices.length > 0 ? "multiselect" : "json";
    return {
      name,
      type: resolved,
      title: asString(schema.title) ?? name,
      description: asString(schema.description) ?? undefined,
      required: required.has(name),
      choices,
      defaultValue: defaultPrimitive(schema.default),
    };
  }

  if (type === "object" || type === "null") {
    return {
      name,
      type: "json",
      title: asString(schema.title) ?? name,
      description: asString(schema.description) ?? undefined,
      required: required.has(name),
      choices: [],
      defaultValue: undefined,
    };
  }

  if (
    type !== "string" &&
    type !== "number" &&
    type !== "integer" &&
    type !== "boolean"
  ) {
    return null;
  }

  const choices = parseChoices(schema);
  return {
    name,
    type: choices.length > 0 ? "select" : type,
    title: asString(schema.title) ?? name,
    description: asString(schema.description) ?? undefined,
    required: required.has(name),
    choices,
    defaultValue: defaultPrimitive(schema.default),
  };
}

/** v1 anchors an elicitation to a session (optionally a tool call); v2 also
 *  allows a bare JSON-RPC request for pre-session auth and configuration. */
function parseScope(
  params: JsonObject,
): AcpElicitationScope | null {
  const sessionId = asString(params.sessionId);
  if (sessionId) {
    return {
      kind: "session",
      sessionId,
      toolCallId: asString(params.toolCallId),
    };
  }
  const requestId = params.requestId;
  if (typeof requestId === "number" || typeof requestId === "string") {
    return { kind: "request", requestId };
  }
  return null;
}

export function parseElicitationRequest(
  id: number | string,
  params: JsonObject,
): AcpElicitationRequest | null {
  const message = asString(params.message);
  if (!message) return null;
  const scope = parseScope(params);

  const mode = asString(params.mode);
  if (mode === "url") {
    const rawUrl = asString(params.url);
    if (!rawUrl) return null;
    try {
      const parsed = new URL(rawUrl);
      if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
        return null;
      }
    } catch {
      return null;
    }
    return {
      mode: "url",
      id,
      scope,
      message,
      title: asString(params.title) ?? null,
      url: rawUrl,
      elicitationId: asString(params.elicitationId) ?? String(id),
    };
  }

  if (mode === "form") {
    const schema = asObject(params.requestedSchema);
    const properties = schema && asObject(schema.properties);
    if (!schema || !properties) return null;
    const required = new Set(
      Array.isArray(schema.required)
        ? schema.required.filter((name): name is string => typeof name === "string")
        : [],
    );
    const fields = Object.entries(properties).flatMap(([name, value]) => {
      const field = parseField(name, value, required);
      return field ? [field] : [];
    });
    if (fields.length !== Object.keys(properties).length) return null;
    return {
      mode: "form",
      id,
      scope,
      message,
      title: asString(schema.title) ?? asString(params.title) ?? null,
      fields,
    };
  }

  // `_`-prefixed and future modes are preserved raw. They must never be
  // rendered as a known mode, and they must not be rejected outright, so the
  // payload survives storage, replay and proxying.
  const { message: _message, ...rest } = params;
  return {
    mode: "other",
    id,
    scope,
    message,
    rawMode: mode ?? "",
    value: rest,
  };
}

export function defaultElicitationValues(
  fields: AcpElicitationField[],
): AcpElicitationValues {
  return Object.fromEntries(
    fields.map((field) => {
      if (field.type === "boolean") {
        return [field.name, field.defaultValue === true];
      }
      if (field.type === "select") {
        const selected = field.choices.find(
          (choice) => choice.value === field.defaultValue,
        );
        return [field.name, selected?.id ?? ""];
      }
      if (field.type === "multiselect") {
        const fallback = Array.isArray(field.defaultValue) ? field.defaultValue : [];
        return [
          field.name,
          field.choices
            .filter((choice) =>
              fallback.some((item) => item === choice.value),
            )
            .map((choice) => choice.id),
        ];
      }
      if (field.type === "json") {
        return [field.name, field.defaultValue === undefined ? "" : JSON.stringify(field.defaultValue)];
      }
      return [field.name, String(field.defaultValue ?? "")];
    }),
  );
}

function isPlainObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Turns the raw form state into the `content` payload, or null when a
 *  required field is missing or a value cannot be coerced. */
export function elicitationContent(
  fields: AcpElicitationField[],
  values: AcpElicitationValues,
): Record<string, AcpElicitationValue> | null {
  const content: Record<string, AcpElicitationValue> = {};
  for (const field of fields) {
    const value = values[field.name];
    if (field.type === "boolean") {
      content[field.name] = value === true;
      continue;
    }
    if (field.type === "select") {
      const choice =
        typeof value === "string" && value !== ""
          ? field.choices.find((item) => item.id === value)
          : undefined;
      if (!choice) {
        if (field.required) return null;
        continue;
      }
      content[field.name] = choice.value;
      continue;
    }
    if (field.type === "multiselect") {
      const ids = Array.isArray(value) ? value : [];
      if (ids.length === 0) {
        if (field.required) return null;
        continue;
      }
      const picked: AcpElicitationValue[] = [];
      for (const id of ids) {
        const choice = field.choices.find((item) => item.id === id);
        if (!choice) return null;
        picked.push(choice.value);
      }
      content[field.name] = picked;
      continue;
    }
    if (field.type === "json") {
      const text = typeof value === "string" ? value.trim() : "";
      if (!text) {
        if (field.required) return null;
        continue;
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        return null;
      }
      if (!isPlainObject(parsed) && !Array.isArray(parsed)) return null;
      content[field.name] = parsed as AcpElicitationValue;
      continue;
    }
    const text = typeof value === "string" ? value.trim() : "";
    if (!text) {
      if (field.required) return null;
      continue;
    }
    if (field.type === "number" || field.type === "integer") {
      const numeric = Number(text);
      if (
        !Number.isFinite(numeric) ||
        (field.type === "integer" && !Number.isInteger(numeric))
      ) {
        return null;
      }
      content[field.name] = numeric;
      continue;
    }
    content[field.name] = text;
  }
  return content;
}