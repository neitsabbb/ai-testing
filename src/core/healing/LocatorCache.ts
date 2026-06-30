/**
 * LocatorCache — persiste les locators réparés.
 * Clé = locator cassé, valeur = alternatifs trouvés par le LLM.
 * Évite de rappeler le LLM (lent) à chaque run pour un même locator cassé.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ElementTarget } from "../locators/target";

// Artefact généré → à la RACINE du repo (pas dans src/), et gitignoré.
// __dirname = src/core/healing → on remonte de 3 crans.
export const DEFAULT_CACHE_FILE = resolve(
  __dirname,
  "../../../.locator-cache.json",
);

/** Entrée de cache : les alternatifs + la date de réparation (traçabilité). */
export interface CacheEntry {
  healedAt: string; // ISO 8601 — quand cette alternative a été trouvée
  locators: ElementTarget[];
}

/** Ancien format (tableau nu) toléré en lecture pour la rétro-compat. */
type StoredEntry = CacheEntry | ElementTarget[];

export default class LocatorCache {
  private readonly store: Record<string, StoredEntry>;

  constructor(private readonly file = DEFAULT_CACHE_FILE) {
    this.store = existsSync(file)
      ? (JSON.parse(readFileSync(file, "utf8")) as Record<string, StoredEntry>)
      : {};
  }

  get(key: string): ElementTarget[] | undefined {
    const entry = this.store[key];
    if (!entry) return undefined;
    // Tableau nu = ancien format sans healedAt.
    return Array.isArray(entry) ? entry : entry.locators;
  }

  /** Enregistre les alternatifs, horodate, et flush sur disque. */
  set(key: string, locators: ElementTarget[]): void {
    const entry: CacheEntry = {
      healedAt: new Date().toISOString(),
      locators,
    };
    this.store[key] = entry;
    writeFileSync(this.file, JSON.stringify(this.store, null, 2));
  }
}
