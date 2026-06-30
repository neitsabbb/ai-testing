/**
 * QuoteFormHelper — remplissage du formulaire de création de devis V3, branché
 * sur le self-healing. Le formulaire vit dans l'iframe `#quoteUpdate` (déclarée
 * comme iframe par défaut), distincte de la liste (`#quotesListIframe`).
 *
 * Flux minimal "happy path" calqué sur turing (`fillMandatoryQuoteFieldsV3`) :
 * référence → client → TVA → conditions de paiement → onglet encodage → une
 * ligne libre → enregistrement.
 *
 * RÈGLE : TOUT élément d'INTERACTION est déclaré dans `el` et résolu via
 * `inFrame` (healing). Le healing tente d'abord le locator d'origine — donc
 * coût nul tant que rien ne casse — et ne répare via le LLM que si le sélecteur
 * a dérivé. Cela vaut pour les locators stables comme pour le champ référence
 * VOLONTAIREMENT cassé (`quote-reference-input` au lieu de
 * `quote-header-reference-input`), qui démontre le healing À L'INTÉRIEUR de
 * l'iframe du formulaire.
 *
 * Deux exceptions légitimement BRUTES (`inFrameRaw`/frame nu) :
 *   1. Les OPTIONS sélectionnées par texte tapé (`getByRole("option",{name})`) :
 *      le `name` est dynamique. Le cache de healing est indexé par `type:value`,
 *      donc `role:option` entrerait en collision entre tous les selects — le
 *      healing n'a aucun sens. L'option apparaît après la saisie clavier ; un
 *      simple polling Playwright suffit.
 *   2. La SONDE rich-text vs legacy de la description : c'est une détection de
 *      présence (`.or()` + `waitFor`), pas une interaction → ne doit pas
 *      déclencher d'appel LLM (même règle que les `waitFor` de readiness).
 */
import type { Page } from "@playwright/test";
import BaseHelper from "./BaseHelper";
import {
  locator,
  role,
  testId,
  type ElementTarget,
} from "../core/locators/target";

/** Iframe qui héberge l'éditeur de devis V3. */
const QUOTE_FORM_IFRAME = "#quoteUpdate";

/** Donnée d'une ligne libre (sous-ensemble de l'interface turing). */
export interface FreeItemLine {
  description: string;
  quantity: number;
  unitType: string;
  unitPrice: number;
}

export default class QuoteFormHelper extends BaseHelper {
  private readonly el = {
    // Cassé : le vrai testId est `quote-header-reference-input`
    reference: testId("quote-reference-input", "champ référence du devis"),
    clientSelect: testId("client-select", "sélecteur de client"),
    vatSelect: testId("vat-rate-select", "sélecteur de taux de TVA"),
    paymentTermsSelect: testId(
      "payment-terms-select",
      "sélecteur des conditions de paiement",
    ),
    encodingTab: testId("quote-encoding-tab-trigger", "onglet encodage"),
    addLine: testId("add-line", "bouton ajouter une ligne"),
    posteLibreItem: role(
      "menuitem",
      "Poste libre",
      "élément 'Poste libre' du menu d'ajout de ligne",
    ),
    // Locators de la ligne : résolus au niveau de la frame (la création
    // minimale n'a qu'UNE ligne → uniques au scope frame, pas besoin de scoper
    // par `[row-index="0"]`).
    lineTypeSelect: testId("type-select", "sélecteur de type de ligne"),
    lineTypeFreeOption: locator(
      '[role="listbox"] div:visible [data-value="FREE_ITEM"]',
      "option de type 'Poste libre'",
    ),
    quantity: testId("quantity-input", "quantité de la ligne"),
    unitTypeSelect: testId("unit-type-select", "sélecteur d'unité de la ligne"),
    unitPrice: testId("unit-price-input", "prix unitaire de la ligne"),
    submit: testId("submit-update-quote-button", "bouton enregistrer le devis"),
  };

  constructor(page: Page) {
    super(page, QUOTE_FORM_IFRAME);
  }

  /** Remplit les champs obligatoires de l'en-tête puis une ligne, et soumet. */
  async createMinimalQuote(
    reference: string,
    data: { client: string; tva: string; paymentTerms: string },
    line: FreeItemLine,
  ): Promise<void> {
    // Le formulaire se monte de façon asynchrone après l'ouverture.
    await this.inFrameRaw(this.el.clientSelect).waitFor({
      state: "visible",
      timeout: 30_000,
    });

    await this.fillReference(reference);
    await this.select(this.el.clientSelect, data.client);
    await this.select(this.el.vatSelect, data.tva);
    await this.select(this.el.paymentTermsSelect, data.paymentTerms);

    await this.openEncodingTab();
    await this.addFreeItemLine(line);

    await this.submit();
  }

  async fillReference(reference: string): Promise<void> {
    await (await this.inFrame(this.el.reference)).fill(reference);
  }

  /**
   * Pattern de sélecteur VertuoSoft : ouvrir la combobox → taper → choisir
   * l'option. Le CHAMP est résolu/réparé via le healing ; l'OPTION (cf. exception
   * 1 en tête de fichier) passe par un locator brut.
   */
  private async select(
    field: ElementTarget,
    optionName: string,
  ): Promise<void> {
    await (await this.inFrame(field)).click();
    await this.page.waitForTimeout(500); // ouverture du menu
    await this.page.keyboard.type(optionName);
    await this.inFrameRaw(role("option", optionName)).first().click();
    await this.page.waitForTimeout(1000); // laisser la mutation se terminer
  }

  async openEncodingTab(): Promise<void> {
    await (await this.inFrame(this.el.encodingTab)).click();
    await this.page.waitForTimeout(1000);
  }

  /** Ajoute une ligne "Poste libre" et la remplit (type, description, qté, prix). */
  async addFreeItemLine(line: FreeItemLine): Promise<void> {
    await (await this.inFrame(this.el.addLine)).click();
    await (await this.inFrame(this.el.posteLibreItem)).click();
    await this.page.waitForTimeout(2000);

    // Type de ligne : combobox custom → option par `data-value` dans la listbox.
    await (await this.inFrame(this.el.lineTypeSelect)).click();
    await (await this.inFrame(this.el.lineTypeFreeOption)).click();
    await this.page.waitForTimeout(1000);

    await this.fillLineDescription(line.description);

    await (await this.inFrame(this.el.quantity)).fill(String(line.quantity));

    await (await this.inFrame(this.el.unitTypeSelect)).click();
    await this.page.keyboard.type(line.unitType);
    await this.inFrameRaw(role("option", line.unitType)).first().click();

    await (await this.inFrame(this.el.unitPrice)).fill(String(line.unitPrice));
    await this.page.waitForTimeout(2000);
  }

  async submit(): Promise<void> {
    await this.page.waitForTimeout(3000); // laisser les mutations en cours finir
    await (await this.inFrame(this.el.submit)).click();
    await this.page.waitForTimeout(5000);
  }

  /**
   * Remplit la cellule description de la ligne, tolérante au flag "rich text"
   * (éditeur Lexical) vs l'ancien `<input>` — le rollout est par tenant. La
   * SONDE de présence reste brute (cf. exception 2 en tête de fichier) ; seul le
   * champ effectivement présent est ensuite manipulé. Résolu au niveau de la
   * frame (création minimale = une seule ligne). Adapté de turing
   * (`lineDescription.helper.ts`).
   */
  private async fillLineDescription(text: string): Promise<void> {
    const frame = this.page.frameLocator(QUOTE_FORM_IFRAME);
    const rich = frame
      .locator(
        '[data-testid$="rich-text-description-input"] [contenteditable="true"]',
      )
      .first();
    const legacy = frame.getByTestId("description-input").first();

    await rich
      .or(legacy)
      .first()
      .waitFor({ state: "visible", timeout: 20_000 });

    if ((await rich.count()) > 0) {
      await rich.click();
      await rich.press("ControlOrMeta+a");
      await rich.press("Delete");
      await rich.pressSequentially(text);
    } else {
      await legacy.click();
      await legacy.fill(text);
    }
  }
}
