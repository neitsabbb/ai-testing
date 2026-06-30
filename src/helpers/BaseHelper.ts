/**
 * BaseHelper — raccourci de résolution d'éléments self-healés pour les Page
 * Objects. On déclare un inventaire d'éléments (`ElementTarget`) puis on agit via
 * des accesseurs :
 *
 *   await (await this.onPage(t)).click()      // page entière, réparé au besoin
 *   await (await this.inFrame(t)).fill("x")   // iframe par défaut, réparé
 *   await this.inFrameRaw(t).waitFor()        // iframe, locator BRUT (pas de healing)
 *
 * Les accesseurs réparants renvoient un `Promise<Locator>` : ils résolvent (et
 * réparent) la cible, on `await` puis on agit comme sur n'importe quel `Locator`.
 *
 * `waitFor` de readiness passe par les variantes `*Raw` : attendre un élément
 * pas-encore-rendu ne doit PAS déclencher un appel LLM (le locator d'origine est
 * correct, il apparaîtra ; le polling de Playwright suffit).
 */
import type { Locator, Page } from "@playwright/test";
import HealingLocator, {
  type FindElement,
} from "../core/healing/HealingLocator";
import { buildLocator, type LocateRoot } from "../core/locators/resolve";
import type { ElementTarget } from "../core/locators/target";

export default abstract class BaseHelper {
  /** Résolveurs réparants, mémoïsés par scope ("page" ou "frame:#sel"). */
  private readonly healers = new Map<string, FindElement>();

  /**
   * @param page
   * @param defaultFrame iframe par défaut (optionnel) ciblée par `inFrame` /
   *   `inFrameRaw` sans avoir à répéter le sélecteur.
   */
  constructor(
    protected readonly page: Page,
    private readonly defaultFrame?: string,
  ) {}

  // --- Accès réparant (self-healing) ------------------------------------

  /** Élément sur la PAGE entière, réparé au besoin. */
  protected onPage(target: ElementTarget): Promise<Locator> {
    return this.pageHealer()(target);
  }

  /** Élément dans l'iframe par défaut, réparé au besoin. */
  protected inFrame(target: ElementTarget): Promise<Locator> {
    if (!this.defaultFrame)
      throw new Error(
        "inFrameRaw() exigent une iframe par défaut (2ᵉ param du constructeur BaseHelper).",
      );

    return this.frameHealer(this.defaultFrame)(target);
  }

  // --- Accès BRUT (sans healing : readiness / waitFor) -------------------

  /** Locator BRUT sur la page (pas de healing) — pour les attentes. */
  protected onPageRaw(target: ElementTarget): Locator {
    return buildLocator(this.page, target);
  }

  /** Locator BRUT dans l'iframe par défaut (pas de healing) — pour les attentes. */
  protected inFrameRaw(target: ElementTarget): Locator {
    if (!this.defaultFrame) {
      throw new Error(
        "inFrameRaw() exigent une iframe par défaut (2ᵉ param du constructeur BaseHelper).",
      );
    }
    return buildLocator(this.page.frameLocator(this.defaultFrame), target);
  }

  // --- Interne ----------------------------------------------------------

  private pageHealer(): FindElement {
    return this.memoHealer(
      "page",
      this.page,
      () => this.page.content(),
      "page",
    );
  }

  private frameHealer(iframeSelector: string): FindElement {
    const frame = this.page.frameLocator(iframeSelector);
    return this.memoHealer(
      `frame:${iframeSelector}`,
      frame,
      () => frame.locator("body").innerHTML(),
      `frame:${iframeSelector}`,
    );
  }

  private memoHealer(
    cacheKey: string,
    root: LocateRoot,
    getHtml: () => Promise<string>,
    scope: string,
  ): FindElement {
    let healer = this.healers.get(cacheKey);
    if (!healer) {
      const hl = new HealingLocator(root, getHtml, scope);
      healer = (target) => hl.findOrHeal(target);
      this.healers.set(cacheKey, healer);
    }
    return healer;
  }

  async goto(url: string): Promise<void> {
    await this.page.goto(url);
  }
}
