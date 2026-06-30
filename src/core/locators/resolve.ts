/**
 * Construction d'un Locator Playwright à partir d'un `ElementTarget`, sans aucun
 * self-healing : c'est la traduction pure (type, value, name) → API `getBy*` /
 * `locator`. Réutilisée par `HealingLocator` (étape "tente l'original / les
 * alternatifs") et par les façades d'action pour des locators bruts (ex.
 * `waitFor` de readiness, qui ne doit PAS déclencher d'appel LLM).
 */
import type { FrameLocator, Locator, Page } from "@playwright/test";
import type { ElementTarget } from "./target";

/**
 * Racine de résolution : la page entière, ou une iframe (`page.frameLocator`).
 * Les deux exposent les mêmes méthodes de localisation (`getBy*`, `locator`),
 * donc `buildLocator` marche à l'identique sur l'une ou l'autre.
 */
export type LocateRoot = Page | FrameLocator;

/** Type du paramètre `role` de getByRole (union de rôles ARIA). */
type AriaRole = Parameters<Page["getByRole"]>[0];

/** Traduit un `ElementTarget` en Locator Playwright (aucun healing). */
export function buildLocator(root: LocateRoot, t: ElementTarget): Locator {
  switch (t.type) {
    // User-facing Playwright (le locator d'origine en est un, idéalement).
    case "role":
      return root.getByRole(t.value as AriaRole, t.name ? { name: t.name } : undefined);
    case "label":
      return root.getByLabel(t.value);
    case "placeholder":
      return root.getByPlaceholder(t.value);
    case "text":
      return root.getByText(t.value);
    case "testId":
      return root.getByTestId(t.value);
    case "altText":
      return root.getByAltText(t.value);
    case "title":
      return root.getByTitle(t.value);
    // "locator" (CSS|XPath) + tout reste : locator auto-détecte "//".
    case "locator":
    default:
      return root.locator(t.value);
  }
}
