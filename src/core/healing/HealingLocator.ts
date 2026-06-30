/**
 * HealingLocator — orchestre le self-healing à l'exécution ("LOCATOR STRATEGY"
 * du diagramme). Pour un locator donné :
 *   1. on tente le locator d'origine (FIND LOCATOR IN POM) ;
 *   2. sinon on tente les alternatifs en cache (CHECK ALTERNATIVE LOCATORS) ;
 *   3. sinon on appelle le LLM avec le DOM (AI HEALING PROCESS), on réessaie,
 *      et on stocke l'alternatif qui marche dans le cache.
 * On ne modifie jamais le code de test : on auto-répare le run.
 */
import type { Locator } from "@playwright/test";
import SelfHealer from "../llm/SelfHealer";
import LocatorCache from "./LocatorCache";
import { STRATEGY_PRIORITY, type ElementTarget } from "../locators/target";
import { buildLocator, type LocateRoot } from "../locators/resolve";

export type { LocateRoot };

/** Juste ce dont HealingLocator a besoin du healer (facilite les tests). */
type Healer = Pick<SelfHealer, "heal">;

/**
 * Résolveur de locator "intelligent" : prend l'intention d'un élément et
 * renvoie son Locator, en se réparant via le LLM si le sélecteur a dérivé.
 * C'est `HealingLocator.findOrHeal` lié à une racine (page ou frame).
 */
export type FindElement = (target: ElementTarget) => Promise<Locator>;

/** Alternative réparée résolue : sa cible, son locator, et la signature de
 * l'élément réellement pointé (pour le consensus inter-alternatives). */
interface Resolved {
  target: ElementTarget;
  locator: Locator;
  signature: string;
}

export default class HealingLocator {
  private readonly healer: Healer;
  private readonly cache;

  /**
   * @param root   où chercher (page ou iframe).
   * @param getHtml source HTML pour le LLM. `Page` a `content()` ; une frame
   *   non (on passe alors l'innerHTML de son body) — d'où l'injection.
   * @param scope identité de la racine ("page" ou `frame:#sel`). Préfixe la clé
   *   de cache : un même `type:value` dans deux frames (ou page vs frame) ne
   *   partage PAS ses alternatives — sinon collision.
   */
  constructor(
    private readonly root: LocateRoot,
    private readonly getHtml: () => Promise<string>,
    private readonly scope = "page",

    /**
     * Fenêtre laissée au locator d'ORIGINE pour apparaître avant de le déclarer
     * cassé. Sans elle, un `.count()` instantané prend un élément au rendu
     * asynchrone (ex. un menu qui vient de s'ouvrir) pour un locator cassé et
     * déclenche un healing inutile. On ne paie cette attente QUE sur les vraies
     * casses (le cas nominal résout tout de suite). Court par design : une vraie
     * casse ne deviendra jamais présente.
     */
    private readonly originalProbeMs = Number(
      process.env.HEAL_ORIGINAL_PROBE_MS ?? 2500,
    ),
  ) {
    this.healer = new SelfHealer();
    this.cache = new LocatorCache();
  }

  /** Résout `broken` en un Locator présent dans la page, en se réparant au besoin. */
  async findOrHeal(broken: ElementTarget): Promise<Locator> {
    // le locator d'origine marche-t-il encore ?
    const original = buildLocator(this.root, broken);
    if (await this.isPresent(original)) return original.first();

    const key = `${this.scope}|${broken.type}:${broken.value}`;

    //  a-t-on déjà une alternative en cache ?
    const cached = this.cache.get(key);
    if (cached) {
      const hit = await this.firstPresentAlternative(cached);
      if (hit) return hit;
    }

    // on passe le DOM (page ou frame) au LLM et on réessaie
    const healed = await this.healer.heal(broken, await this.getHtml());

    const resolving = await this.resolvingAlternatives(healed);

    if (!resolving.length)
      throw new Error(`Self-healing impossible pour ${key}`);

    // Le LLM (surtout un petit modèle local) renvoie parfois des alternatives
    // qui pointent vers des éléments DIFFÉRENTS — typiquement le bon champ +
    // un élément halluciné sans rapport (ex. le bouton "Se connecter" proposé
    // pour un "champ identifiant"). On ne peut pas faire confiance au seul tri
    // par stratégie : un `role` halluciné passerait devant le `locator` correct.
    // On retient donc le groupe d'alternatives qui CONVERGENT sur le même
    // élément (consensus), departagé par l'ancre la plus fiable.
    const consensus = this.chooseConsensus(resolving);

    // Au sein du groupe retenu (toutes ces alternatives visent LE MÊME élément),
    // on range selon NOTRE ordre d'importance avant de cacher : le plus fiable
    // (testId…) passe en tête pour les prochains runs.
    consensus.sort((a, b) => this.priority(a.target) - this.priority(b.target));

    this.cache.set(
      key,
      consensus.map((r) => r.target),
    );

    return consensus[0].locator;
  }

  /**
   * Parmi les alternatives qui résolvent, retient celles ciblant le MÊME élément
   * que le plus grand nombre d'entre elles (consensus). À égalité de taille, on
   * préfère le groupe dont l'ancre est la plus fiable : un sélecteur structurel
   * copié verbatim de la source (testId, id/attribut via `locator`) est bien
   * moins sujet à hallucination qu'un `role`/`text` dont le LLM a inventé le nom.
   */
  private chooseConsensus(resolved: Resolved[]): Resolved[] {
    const groups = new Map<string, Resolved[]>();
    for (const r of resolved) {
      const g = groups.get(r.signature) ?? [];
      g.push(r);
      groups.set(r.signature, g);
    }

    return [...groups.values()].sort((a, b) => {
      if (b.length !== a.length) return b.length - a.length; // groupe majoritaire
      return this.bestTrust(a) - this.bestTrust(b); // sinon ancre la plus fiable
    })[0];
  }

  /** Meilleur (plus petit) score de confiance d'un groupe ; cf. `trust`. */
  private bestTrust(group: Resolved[]): number {
    return Math.min(...group.map((r) => this.trust(r.target)));
  }

  /**
   * Confiance accordée à une stratégie pour DÉPARTAGER des éléments en conflit
   * (plus petit = plus fiable). Inverse partiel de STRATEGY_PRIORITY : ici on
   * privilégie les ancres techniques copiées de la source (testId, locator) car
   * elles ne peuvent pas être "inventées" ; les noms accessibles (role/text/…),
   * eux, sont rédigés par le LLM et plus facilement hallucinés.
   */
  private trust(t: ElementTarget): number {
    return t.type === "testId" || t.type === "locator" ? 0 : 1;
  }

  /** Rang d'importance d'une stratégie (cf. STRATEGY_PRIORITY) ; inconnu → fin. */
  private priority(t: ElementTarget): number {
    const i = STRATEGY_PRIORITY.indexOf(t.type);
    return i === -1 ? STRATEGY_PRIORITY.length : i;
  }

  /**
   * Sous-ensemble des alternatives qui désignent un seul élément, dédupliquées
   * (le LLM renvoie parfois la même cible deux fois — ex. testId + son
   * équivalent CSS normalisé), ordre préservé. Chaque entrée porte une
   * SIGNATURE de l'élément réellement ciblé, pour regrouper les alternatives qui
   * convergent (cf. `chooseConsensus`).
   */
  private async resolvingAlternatives(
    alternatives: ElementTarget[],
  ): Promise<Resolved[]> {
    const out: Resolved[] = [];
    const seen = new Set<string>();
    for (const alt of alternatives) {
      const id = `${alt.type}:${alt.value}:${alt.name ?? ""}`;
      if (seen.has(id)) continue;
      try {
        const loc = buildLocator(this.root, alt);
        if (await this.isUnique(loc)) {
          seen.add(id);
          out.push({
            target: alt,
            locator: loc,
            signature: await this.signature(loc),
          });
        }
      } catch {
        // locator invalide → on l'écarte
      }
    }
    return out;
  }

  /**
   * Signature stable de l'élément pointé, pour détecter quand deux alternatives
   * visent le MÊME élément (consensus) ou non. On combine balise + ancres
   * d'identité + un fragment de texte — suffisant pour distinguer un `<input>`
   * d'un `<button>`.
   */
  private async signature(loc: Locator): Promise<string> {
    return loc.evaluate((el) => {
      const attr = (n: string) => el.getAttribute(n) ?? "";
      return [
        el.tagName,
        el.id,
        attr("name"),
        attr("data-testid"),
        (el.textContent ?? "").trim().slice(0, 40),
      ].join("|");
    });
  }

  /**
   * Premier alternatif qui désigne UN SEUL élément, dans l'ordre renvoyé par le
   * LLM (le plus robuste d'abord). Construction lazy + try/catch : un locator
   * bancal proposé par le LLM (rôle ARIA inconnu, sélecteur invalide) est ignoré.
   *
   * On exige l'unicité (count === 1), pas la simple présence : un candidat
   * ambigu comme {role:"textbox"} matche plusieurs champs, et `.first()`
   * taperait silencieusement le mauvais élément. En le rejetant, on retombe sur
   * le candidat suivant réellement unique (placeholder, id…).
   */
  private async firstPresentAlternative(
    alternatives: ElementTarget[],
  ): Promise<Locator | null> {
    for (const alt of alternatives) {
      try {
        const loc = buildLocator(this.root, alt);
        if (await this.isUnique(loc)) return loc;
      } catch {
        // locator invalide → on passe au suivant
      }
    }
    return null;
  }

  /**
   * Le locator d'origine est-il là ? On lui laisse `originalProbeMs` pour
   * devenir VISIBLE (gère le rendu asynchrone) ; un dépassement = réellement
   * absent → on passe au healing. On vise `visible` et non un simple `count`
   * attaché : on s'apprête à AGIR dessus.
   */
  private async isPresent(loc: Locator): Promise<boolean> {
    try {
      await loc
        .first()
        .waitFor({ state: "visible", timeout: this.originalProbeMs });
      return true;
    } catch {
      return false;
    }
  }

  /** Désigne exactement un élément (anti-ambiguïté pour les candidats du LLM). */
  private async isUnique(loc: Locator): Promise<boolean> {
    return (await loc.count()) === 1;
  }
}
