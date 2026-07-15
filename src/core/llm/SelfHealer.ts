/**
 * SelfHealer — quand un locator casse, passe au LLM le locator échoué
 * (type + valeur) + la source HTML, et récupère une LISTE de locators
 * alternatifs (`ElementTarget[]`, le meilleur d'abord) en JSON strict. On ne
 * modifie pas le code de test : on auto-répare l'exécution.
 */
import LLMClient from "./LLMClient";
import type { ElementTarget } from "../locators/target";

interface HealResponse {
  locators?: ElementTarget[];
}

/** `[data-testid='x']` (souvent renvoyé en type "locator") → type "testId". */
const DATA_TESTID_CSS = /^\[data-test-?id=['"]([^'"]+)['"]\]$/;

function normalizeTarget(t: ElementTarget): ElementTarget {
  if (t.type === "locator") {
    const m = DATA_TESTID_CSS.exec(t.value.trim());
    if (m) return { ...t, type: "testId", value: m[1] };
  }
  return t;
}

export default class SelfHealer {
  constructor(private readonly llm = new LLMClient()) {}

  /** Locators alternatifs pour le `broken` introuvable, d'après le HTML. */
  async heal(
    broken: ElementTarget,
    pageSource: string,
  ): Promise<ElementTarget[]> {
    const prompt = this.buildPrompt(broken, this.stripNoise(pageSource));
    const { locators } = await this.llm.completeJson<HealResponse>(prompt);
    // On filtre les entrées vides et on normalise un data-testid exprimé en CSS
    // ([data-testid='x']) vers le type "testId" — pour qu'il passe par
    // getByTestId et bénéficie de sa priorité (cf. STRATEGY_PRIORITY).
    return (locators ?? []).filter((l) => l?.value).map(normalizeTarget);
  }

  /**
   * Attributs CONSERVÉS sur chaque balise. Tout le reste (`class`, `style`,
   * `aria-*` non pertinents, `data-*` divers…) est jeté : sur un DOM MUI/AG-Grid,
   * les chaînes `class`/`style` pèsent l'essentiel du markup et ne servent jamais
   * à localiser une cible de test. On garde les ancres utiles aux `getBy*` /
   * `locator` (testId, id, name, rôle, texte de placeholder/label/alt/title…) +
   * `data-value` (options de combobox custom) et `contenteditable` (éditeurs
   * rich-text). Réduit la source de ~50-70% → le formulaire tient dans le
   * `num_ctx` au lieu d'être tronqué (le champ visé n'atteignait jamais le modèle).
   */
  private static readonly KEEP_ATTRS = new Set([
    "data-testid",
    "data-test-id",
    "data-value",
    "id",
    "name",
    "role",
    "type",
    "placeholder",
    "aria-label",
    "aria-labelledby",
    "title",
    "alt",
    "for",
    "href",
    "value",
    "label",
    "contenteditable",
  ]);

  /**
   * Allège le HTML avant de l'envoyer au LLM : sur une vraie page, scripts de
   * tracking, styles, SVG inline et surtout les attributs `class`/`style`
   * gonflent la source (≈70 Ko sur le login QA, bien plus sur le formulaire
   * devis) et noient le formulaire → un petit modèle résume le bruit au lieu de
   * chercher l'élément, ou la source dépasse le contexte et est tronquée. On
   * retire ce bruit et on ne garde que les attributs localisants. C'est du
   * "context engineering" : meilleure entrée → meilleur healing.
   */
  private stripNoise(html: string): string {
    return this.stripAttributes(
      html
        .replace(/<head\b[^>]*>[\s\S]*?<\/head>/gi, "")
        .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
        .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "")
        .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, "")
        // Les SVG inline (icônes de datagrid) pèsent l'essentiel d'une vraie page
        // et n'aident jamais à localiser : un <svg> n'est pas une cible de test.
        .replace(/<svg\b[^>]*>[\s\S]*?<\/svg>/gi, "")
        .replace(/<!--[\s\S]*?-->/g, ""),
    )
      .replace(/\s+/g, " ")
      .trim();
  }

  /** Sur chaque balise ouvrante, ne garde que les attributs de `KEEP_ATTRS`. */
  private stripAttributes(html: string): string {
    const ATTR = /([^\s/=]+)(\s*=\s*("[^"]*"|'[^']*'|[^\s"'>]+))?/g;
    return html.replace(
      /<([a-zA-Z][\w-]*)\b([^>]*?)(\/?)>/g,
      (_m, tag: string, attrs: string, selfClose: string) => {
        const kept: string[] = [];
        for (const [, name, assign] of attrs.matchAll(ATTR)) {
          if (SelfHealer.KEEP_ATTRS.has(name.toLowerCase())) {
            kept.push(assign ? `${name}${assign}` : name);
          }
        }
        const head = kept.length ? `<${tag} ${kept.join(" ")}` : `<${tag}`;
        return `${head}${selfClose ? "/" : ""}>`;
      },
    );
  }

  /**
   * Annonce le locator comme INTROUVABLE et demande des alternatifs basés sur le
   * HTML, en JSON strict et sans explication. La consigne "JSON only" double le
   * `format: "json"` d'Ollama, utile pour rester portable vers un LLM cloud.
   * On demande une LISTE ordonnée (plus robuste d'abord), dans le vocabulaire
   * Playwright `ElementTarget` — donc directement consommable, sans 2ᵉ format.
   */
  buildPrompt(broken: ElementTarget, pageSource: string): string {
    // Contexte sémantique = la FONCTION de l'élément (friendlyName), pas son
    // implémentation technique. Quand il est fourni, c'est le signal PRINCIPAL
    // (il retrouve l'élément même si la valeur a été renommée sans rapport).
    // Quand il est ABSENT, le seul indice est la valeur technique cassée : on
    // s'appuie dessus et on ne demande surtout PAS de l'ignorer (sinon plus
    // aucun signal). On branche donc les deux cas.
    const cible = broken.friendlyName
      ? `Cible = l'élément dont la FONCTION est : "${broken.friendlyName}".
Son ancien locator (type "${broken.type}", valeur "${broken.value}") a pu être
renommé — fie-toi à la FONCTION, pas à cette valeur.`
      : `Cible = l'élément que visait le locator introuvable (type "${broken.type}",
valeur "${broken.value}"). Cette valeur est ton seul indice.`;

    return `Tu répares un locator de test cassé à partir du HTML (tout en bas).
${cible}
Identifie CET élément précis dans la source et donne des locators alternatifs
pour LUI, du plus robuste au moins robuste. Uniquement des valeurs présentes
dans la source, désignant UN SEUL élément.

Réponds par CE JSON, rien d'autre : {"locators":[{"type","value","name"?}, ...]}
- type : "testId" | "role" | "label" | "placeholder" | "text" | "altText" | "title" | "locator"
- value : le rôle ARIA pour "role" ; un CSS/XPath pour "locator" ; sinon le texte/label/placeholder recopié EXACTEMENT.
- name : nom accessible, OBLIGATOIRE si type "role" (sinon "textbox" est ambigu), interdit sinon.

Priorité absolue : si la balise cible porte un "data-testid", le 1ᵉʳ locator DOIT
être {"type":"testId","value":"<recopié exact>"} (ne le remplace jamais par un
sélecteur reconstruit). Puis un "id" en {"type":"locator","value":"#id"} s'il existe.
Sinon role/label/placeholder/text. N'invente aucune valeur absente de la source.

# SOURCE DE LA PAGE
${pageSource}`;
  }
}
