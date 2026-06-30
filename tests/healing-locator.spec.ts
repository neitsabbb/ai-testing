import { test, expect } from "@playwright/test";
import { existsSync, rmSync } from "node:fs";
import HealingLocator from "../src/core/healing/HealingLocator";
import { DEFAULT_CACHE_FILE } from "../src/core/healing/LocatorCache";
import { locator } from "../src/core/locators/target";

const PAGE_SOURCE = `
<form id="login-form">
  <input id="username" name="user" class="form-control" type="text" data-testid="user-input" />
  <button id="submit" type="submit">Se connecter</button>
</form>`;

const BROKEN = locator("#user-name", "champ nom d'utilisateur");

test.beforeEach(() => {
  if (existsSync(DEFAULT_CACHE_FILE)) rmSync(DEFAULT_CACHE_FILE);
});

test("HealingLocator répare un locator cassé puis sert le cache", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.setContent(PAGE_SOURCE);

  // 1er run : le locator cassé déclenche le AI HEALING PROCESS.
  const input = await new HealingLocator(page, () => page.content()).findOrHeal(
    BROKEN,
  );
  await input.fill("toto");
  await expect(input).toHaveValue("toto");
  expect(existsSync(DEFAULT_CACHE_FILE)).toBe(true); // l'alternative est stocké

  // 2e run : nouvelle instance → l'alternative vient du cache (pas de LLM).
  const again = await new HealingLocator(page, () => page.content()).findOrHeal(
    BROKEN,
  );
  await expect(again).toHaveValue("toto");
});
