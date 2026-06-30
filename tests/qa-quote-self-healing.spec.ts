import { test, expect } from "@playwright/test";
import { existsSync, rmSync } from "node:fs";
import LoginHelper from "../src/helpers/LoginHelper";
import QuotePageHelper from "../src/helpers/QuotePageHelper";
import QuoteFormHelper from "../src/helpers/QuoteFormHelper";
import { DEFAULT_CACHE_FILE } from "../src/core/healing/LocatorCache";

/** Référence unique pour retrouver le devis créé dans la grille. */
function uniqueReference(): string {
  return `QA-SH-${Date.now()}`;
}

/** Statut attendu d'un devis fraîchement créé (cf. turing : statusV3.toSend). */
const STATUS_TO_SEND = "A envoyer";

test.beforeEach(() => {
  if (existsSync(DEFAULT_CACHE_FILE)) rmSync(DEFAULT_CACHE_FILE);
});

test("self-healing : crée un devis de bout en bout malgré 3 locators cassés", async ({
  page,
}) => {
  // Login + nav + création + 3 healings froids (appels LLM ~1 min chacun) →
  // bien au-delà des 30 s par défaut.
  test.setTimeout(300_000);

  const reference = uniqueReference();

  // 1. Login (le champ identifiant est cassé → healing sur la page).
  await page.goto(process.env.BASE_URL!);
  const login = new LoginHelper(page);
  await login.fillUsername(process.env.EMAIL!);
  await login.fillPassword(process.env.PASSWORD!);
  await login.submit();

  // 2. Ouvrir la création (le bouton "Nouveau devis" est cassé → healing dans
  //    l'iframe de la liste).
  const quotes = new QuotePageHelper(page);
  await quotes.navigateToQuote();
  await quotes.clickNewButton();

  // 3. Remplir + soumettre (le champ référence est cassé → healing dans
  //    l'iframe du formulaire).
  const form = new QuoteFormHelper(page);
  await form.createMinimalQuote(
    reference,
    {
      client: "Dupuis",
      tva: "6 % (TVA Belge)",
      paymentTerms: "15 jour(s) après date de facturation",
    },
    {
      description: "Achat et pose d'une installation photovoltaïque",
      quantity: 1,
      unitType: "Forfait",
      unitPrice: 1000,
    },
  );

  // 4. Vérifier que le devis apparaît dans la grille avec le bon statut.
  await quotes.searchForQuote(reference);
  await expect(async () => {
    await expect(quotes.grid()).toContainText(reference, { timeout: 3000 });
    await expect(quotes.grid()).toContainText(STATUS_TO_SEND, { timeout: 3000 });
  }).toPass({ timeout: 60_000 });

  // Le cache a bien persisté les alternatives réparées pour les prochains runs.
  expect(existsSync(DEFAULT_CACHE_FILE)).toBe(true);
});
