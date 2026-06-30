import { test, expect } from "@playwright/test";
import { existsSync, rmSync } from "node:fs";
import { locator } from "../src/core/locators/target";
import HealingLocator from "../src/core/healing/HealingLocator";
import { DEFAULT_CACHE_FILE } from "../src/core/healing/LocatorCache";

/**
 * Self-healing DANS une iframe (cas VertuoSoft V3). Le champ vit dans la frame
 * `#appV3`, pas dans le body top : on prouve que (1) la résolution se scope à la
 * frame et (2) le LLM reçoit bien le HTML de la frame (pas `page.content()`,
 * qui ignore les iframes). Locator volontairement cassé : "#user-name" alors
 * que le vrai champ est "#username". Ollama requis.
 */
const HTML = `<h1>Shell top</h1><iframe id="appV3" srcdoc='<form>
  <label>Identifiant <input id="username" name="login" type="text" /></label>
  <button type="submit">Se connecter</button>
</form>'></iframe>`;

test.beforeEach(() => {
  if (existsSync(DEFAULT_CACHE_FILE)) rmSync(DEFAULT_CACHE_FILE);
});

test("self-healing résout un locator cassé à l'intérieur d'une iframe", async ({
  page,
}) => {
  // Cold start Ollama + appel LLM → marge large.
  test.setTimeout(120_000);
  await page.setContent(HTML);

  // Le champ n'existe PAS au niveau top : il est dans la frame.
  expect(await page.locator("#username").count()).toBe(0);

  // On instancie HealingLocator directement sur la frame (sans helper de page).
  const frame = page.frameLocator("#appV3");
  const healer = new HealingLocator(
    frame,
    () => frame.locator("body").innerHTML(),
    "frame:#appV3",
  );
  const input = await healer.findOrHeal(locator("#user-name", "champ identifiant"));

  await input.fill("toto");
  await expect(input).toHaveValue("toto");

  // C'est bien le champ DANS la frame qui a été résolu.
  await expect(page.frameLocator("#appV3").locator("#username")).toHaveValue(
    "toto",
  );
  expect(existsSync(DEFAULT_CACHE_FILE)).toBe(true);
});
