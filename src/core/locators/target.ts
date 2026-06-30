/**
 * Vocabulaire d'auteur des locators, calqué 1:1 sur les `getBy*` de Playwright
 * (et non sur les `By.*` de Selenium). Ordre de robustesse recommandé :
 * role → label → placeholder → text → testId (+ altText/title), puis css/xpath
 * en dernier recours.
 *
 * Le LLM RENVOIE d'ailleurs ses alternatives dans ce même vocabulaire : un
 * `ElementTarget[]` (cf. SelfHealer), directement consommable par le résolveur.
 */

/** Stratégies de locator — chacune correspond à une API Playwright. */
export type LocatorStrategy =
  | "role" // getByRole(value, { name })
  | "label" // getByLabel
  | "placeholder" // getByPlaceholder
  | "text" // getByText
  | "testId" // getByTestId
  | "altText" // getByAltText
  | "title" // getByTitle
  | "locator"; // locator(css|xpath) — auto-détecté

/**
 * Ordre d'importance des stratégies (du plus fiable au moins fiable), pour
 * trier les alternatives réparées AVANT de les mettre en cache. C'est NOTRE
 * politique, pas l'ordre (variable) renvoyé par le LLM.
 *
 * `testId` en tête : c'est un point d'ancrage de test dédié et intentionnel,
 * le plus stable. Puis les locators sémantiques/accessibles (role, label…),
 * puis le texte visible (sensible à l'i18n/au contenu), et enfin `locator`
 * (CSS/XPath brut = détail d'implémentation, le plus fragile).
 */
export const STRATEGY_PRIORITY: LocatorStrategy[] = [
  "testId",
  "role",
  "label",
  "placeholder",
  "altText",
  "title",
  "text",
  "locator",
];

/**
 * Description d'un élément visé : la stratégie + sa valeur, plus une intention
 * en clair. C'est ce qu'on déclare dans un helper ; le résolveur la prend, tente
 * l'origine, puis se répare via le LLM si besoin. Le `friendlyName` sert d'indice
 * au LLM pour retrouver le bon élément quand le sélecteur a dérivé.
 */
export interface ElementTarget {
  type: LocatorStrategy;
  /** Valeur du locator. Pour `role` : le rôle ARIA ("button", "textbox"…). */
  value: string;
  /** Nom accessible — utilisé uniquement par `role` (getByRole's `name`). */
  name?: string;
  /**
   * Contexte sémantique : la FONCTION de l'élément en clair (ex. "champ
   * identifiant", "bouton de connexion"). C'est le signal PRINCIPAL du healing —
   * il permet de retrouver l'élément même si `value` (id/classe/nom) a été
   * renommé au point de n'avoir plus aucun rapport. Optionnel mais fortement
   * recommandé : sans lui, le LLM n'a que la valeur technique cassée.
   */
  friendlyName?: string;
}

/**
 * Builders concis, un par `getBy*`, pour déclarer un `ElementTarget` :
 *   private readonly submit   = role("button", "Se connecter");
 *   private readonly email    = label("Adresse e-mail");
 *   private readonly username = locator('[name="login"]', "champ identifiant");
 * Le builder fixe la stratégie — `type` ne peut plus être une chaîne fausse.
 */
const make =
  (type: LocatorStrategy) =>
  (value: string, friendlyName?: string): ElementTarget => ({
    type,
    value,
    friendlyName,
  });

/** getByRole : le rôle ARIA + un nom accessible optionnel. */
export const role = (
  ariaRole: string,
  name?: string,
  friendlyName?: string,
): ElementTarget => ({ type: "role", value: ariaRole, name, friendlyName });

export const label = make("label");
export const placeholder = make("placeholder");
export const text = make("text");
export const testId = make("testId");
export const altText = make("altText");
export const title = make("title");

/** locator() : sélecteur CSS ou XPath (Playwright auto-détecte "//" comme XPath). */
export const locator = make("locator");
