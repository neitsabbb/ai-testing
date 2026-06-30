/**
 * QuotePageHelper — flux d'entrée du module devis (navigation + ouverture de la
 * création), branché sur le self-healing. La liste des devis vit dans l'iframe
 * `#quotesListIframe` (déclarée comme iframe par défaut).
 *
 * Le bouton "Nouveau devis" porte un testId VOLONTAIREMENT cassé
 * (`new-quote-button` au lieu de `create-new-quote-button`) : à l'exécution, le
 * LLM reçoit le HTML de la frame et retrouve le bon élément.
 */
import type { Locator, Page } from "@playwright/test";
import BaseHelper from "./BaseHelper";
import { locator, testId } from "../core/locators/target";

/** Iframe qui héberge la liste des devis V3. */
const QUOTE_LIST_IFRAME = "#quotesListIframe";

export default class QuotePageHelper extends BaseHelper {
  private readonly el = {
    navOffers: locator("#navOffers_tag", "onglet Offres"), // page
    newQuote: testId("new-quote-button", "bouton nouveau devis"), // frame, cassé
    search: testId("datagrid-global-search-input"), // frame, stable (readiness)
    grid: testId("quotes"), // frame, le tableau des devis
  };

  constructor(page: Page) {
    super(page, QUOTE_LIST_IFRAME);
  }

  /** Va sur le module devis (onglet hors iframe), puis attend la frame prête. */
  async navigateToQuote(): Promise<void> {
    await (await this.onPage(this.el.navOffers)).click();
    await this.inFrameRaw(this.el.search).waitFor({
      state: "visible",
      timeout: 30_000,
    });
  }

  /** Ouvre le formulaire de création (résout/répare le bouton dans l'iframe). */
  async clickNewButton(): Promise<void> {
    await (await this.inFrame(this.el.newQuote)).click();
  }

  /** Recherche un devis dans la grille (locators stables → pas de healing). */
  async searchForQuote(reference: string): Promise<void> {
    await this.inFrameRaw(this.el.search).fill(reference);
    await this.page.waitForTimeout(2000);
    await this.page.keyboard.press("Enter");
    await this.page.waitForTimeout(3000);
  }

  /** Locator brut du tableau des devis, pour les assertions de la grille. */
  grid(): Locator {
    return this.inFrameRaw(this.el.grid);
  }
}
