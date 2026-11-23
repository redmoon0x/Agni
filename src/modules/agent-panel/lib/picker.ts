import type { AddableRow } from "@/modules/agent-panel/lib/addable";
import type { CatalogModel } from "@/modules/agent-panel/lib/modelCatalog";

/** T3 shows 1-9 next to models; those keys pick a model straight from the list. */
export const PICKER_JUMP_LIMIT = 9;

export function pickerJumpLabel(index: number): string | null {
  return index >= 0 && index < PICKER_JUMP_LIMIT ? String(index + 1) : null;
}

/** Index (0-based) of the model a jump key selects, or null when out of range. */
export function pickerJumpIndex(key: string): number | null {
  if (!/^[1-9]$/.test(key)) return null;
  return Number(key) - 1;
}

export function rowMatchesQuery(row: AddableRow, needle: string): boolean {
  if (!needle) return true;
  return `${row.label} ${row.profileLabel ?? ""} ${row.transport}`
    .toLowerCase()
    .includes(needle);
}

export function filterAgentRows(
  rows: readonly AddableRow[],
  query: string,
): AddableRow[] {
  const needle = query.trim().toLowerCase();
  return rows.filter((row) => rowMatchesQuery(row, needle));
}

export function modelMatchesQuery(
  model: CatalogModel,
  needle: string,
): boolean {
  if (!needle) return true;
  return `${model.name} ${model.id} ${model.groupName ?? ""} ${model.groupId ?? ""}`
    .toLowerCase()
    .includes(needle);
}

export type ModelCostFilter = "all" | "free" | "paid";

const FREE_PROVIDER_HINTS = [
  "ollama",
  "lmstudio",
  "lm-studio",
  "llamacpp",
  "llama.cpp",
  "vllm",
  "local",
  "jan",
];

/** Harnesses mark free models in the id/name (`*-free`, `:free`) or run locally. */
export function modelIsFree(model: CatalogModel): boolean {
  const searchable = `${model.id} ${model.name} ${model.description ?? ""}`;
  if (/\bfree\b/i.test(searchable)) return true;
  const provider =
    `${model.groupId ?? ""} ${model.groupName ?? ""}`.toLowerCase();
  return FREE_PROVIDER_HINTS.some((hint) => provider.includes(hint));
}

export function filterCatalogModels(
  models: readonly CatalogModel[],
  query: string,
  cost: ModelCostFilter = "all",
): CatalogModel[] {
  const needle = query.trim().toLowerCase();
  return models.filter((model) => {
    if (cost !== "all" && modelIsFree(model) !== (cost === "free"))
      return false;
    return modelMatchesQuery(model, needle);
  });
}

export type CatalogGroup = {
  key: string;
  label: string | null;
  models: CatalogModel[];
};

/** Groups consecutive models by their ACP provider group, keeping list order. */
export function groupCatalogModels(
  models: readonly CatalogModel[],
): CatalogGroup[] {
  const groups: CatalogGroup[] = [];
  for (const model of models) {
    const key = model.groupId ?? model.groupName ?? "";
    const label = model.groupName ?? null;
    const last = groups[groups.length - 1];
    if (last && last.key === key) {
      last.models.push(model);
      continue;
    }
    groups.push({ key, label, models: [model] });
  }
  return groups;
}
