import { test, expect } from "@playwright/test";
import SelfHealer from "../src/core/llm/SelfHealer";

// Simule un locator cassé : on passe au LLM le locator introuvable + la source
// HTML, et on attend un locator alternatif qui marche (Ollama doit tourner).
// cf. "prompting-llms-self-healed-alternative-locators".
const PAGE_SOURCE = `
<form id="login-form">
  <input id="username" name="user" class="form-control" type="text" />
  <input id="password" name="pass" class="form-control" type="password" />
  <button id="submit" type="submit">Se connecter</button>
  <a id="register-link" href="/register">S'inscrire</a>
</form>`;

test("SelfHealer suggère un locator alternatif en JSON", async () => {
  // 1er appel = cold start du modèle → marge large.
  test.setTimeout(120_000);
  const healer = new SelfHealer();
  // Locator cassé : l'id a "changé", #user-name n'existe pas dans la source.
  const locators = await healer.heal(
    {
      type: "locator",
      value: "#user-name",
      friendlyName: "champ nom d'utilisateur",
    },
    PAGE_SOURCE,
  );
  console.log("Locators:", locators);

  // Le LLM doit renvoyer une LISTE non vide d'ElementTarget...
  expect(Array.isArray(locators)).toBe(true);
  expect(locators.length).toBeGreaterThan(0);
  // ...chacun avec au moins un type et une valeur exploitables.
  for (const loc of locators) {
    expect(loc.type).toBeTruthy();
    expect(loc.value).toBeTruthy();
  }
});
