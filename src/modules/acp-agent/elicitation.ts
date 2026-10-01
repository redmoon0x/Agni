import type {
  AcpElicitationField,
  AcpElicitationRequest,
} from "@/modules/acp-agent/types";

type JsonObject = Record<string, unknown>;

function asObject(value: unknown): JsonObject | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function isPrimitive(value: unknown): value is string | number | boolean {
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean";
}

function choiceId(value: string | number | boolean): string {
  return `${typeof value}:${String(value)}`;
}

function parseChoices(value: unknown): AcpElicitationField["choices"] {
  if (Array.isArray(value)) {
    return value.flatMap((item) => {
      return isPrimitive(item)
        ? [{ id: choiceId(item), value: item, name: String(item) }]
        : [];
    });
  }
  const schema = asObject(value);
  const oneOf = schema && Array.isArray(schema.oneOf) ? schema.oneOf : [];
  return oneOf.flatMap((item) => {
    const option = asObject(item);
    if (!option) return [];
    const value = option.const;
    if (!isPrimitive(value)) return [];
    return [{
      id: choiceId(value),
      value,
      name: asString(option.title) ?? String(value),
      description: asString(option.description) ?? undefined,
    }];
  });
}

function parseField(
  name: string,
  value: unknown,
  required: Set<string>,
): AcpElicitationField | null {
  const schema = asObject(value);
  if (!schema) return null;
  const type = asString(schema.type);
  if (type !== "string" && type !== "number" && type !== "integer" && type !== "boolean") {
    return null;
  }
  const choices = parseChoices(schema.enum ?? schema);
  return {
    name,
    type: choices.length > 0 ? "select" : type,
    title: asString(schema.title) ?? name,
    description: asString(schema.description) ?? undefined,
    required: required.has(name),
    choices,
    defaultValue:
      typeof schema.default === "string" ||
      typeof schema.default === "number" ||
      typeof schema.default === "boolean"
        ? schema.default
        : undefined,
  };
}

export function parseElicitationRequest(
  id: number | string,
  params: JsonObject,
): AcpElicitationRequest | null {
  if (params.mode !== "form") return null;
  const message = asString(params.message);
  const schema = asObject(params.requestedSchema);
  const properties = schema && asObject(schema.properties);
  if (!message || !schema || !properties) return null;
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
  return { id, message, title: asString(schema.title) ?? null, fields };
}

export function defaultElicitationValues(
  fields: AcpElicitationField[],
): Record<string, string | boolean> {
  return Object.fromEntries(
    fields.map((field) => {
      const selected = field.choices.find(
        (choice) => choice.value === field.defaultValue,
      );
      return [
        field.name,
        field.type === "boolean"
          ? field.defaultValue === true
          : field.type === "select"
            ? (selected?.id ?? "")
            : String(field.defaultValue ?? ""),
      ];
    }),
  );
}

export function elicitationContent(
  fields: AcpElicitationField[],
  values: Record<string, string | boolean>,
): Record<string, string | number | boolean> | null {
  const content: Record<string, string | number | boolean> = {};
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
    const text = typeof value === "string" ? value.trim() : "";
    if (!text) {
      if (field.required) return null;
      continue;
    }
    if (field.type === "number" || field.type === "integer") {
      const numeric = Number(text);
      if (!Number.isFinite(numeric) || (field.type === "integer" && !Number.isInteger(numeric))) {
        return null;
      }
      content[field.name] = numeric;
      continue;
    }
    content[field.name] = text;
  }
  return content;
}
