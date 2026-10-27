// ADR-0008: owner configuration only orders models that Pi reports usable.
import { readFileSync } from "node:fs";

export const MODEL_PICKER_CONFIG_PATH = "caretaker.config.json";
const MAX_CONFIGURED_MODELS = 5;

/** Returns validated owner order, or [] for missing/malformed configuration. */
export function readConfiguredModelIds(readFile: (path: string) => string = (path) => readFileSync(path, "utf8")): string[] {
  try {
    const value: unknown = JSON.parse(readFile(MODEL_PICKER_CONFIG_PATH));
    if (typeof value !== "object" || value === null || Array.isArray(value)) return [];
    const config = value as Record<string, unknown>;
    if (Object.keys(config).some((key) => key !== "models")) return [];
    const models = config.models;
    if (!Array.isArray(models) || models.length === 0 || models.length > MAX_CONFIGURED_MODELS) return [];
    if (!models.every((model) => typeof model === "string" && /^[^/\s]+\/[^/\s]+$/.test(model))) return [];
    return models as string[];
  } catch {
    return [];
  }
}

export function prioritizeConfiguredModels<T extends { provider: string; id: string }>(available: readonly T[], configuredIds: readonly string[]): T[] {
  if (configuredIds.length === 0) return [...available];
  const byId = new Map(available.map((model) => [`${model.provider}/${model.id}`, model]));
  const selected: T[] = [];
  for (const id of configuredIds) {
    const model = byId.get(id);
    if (model !== undefined && !selected.includes(model)) selected.push(model);
  }
  return selected;
}
