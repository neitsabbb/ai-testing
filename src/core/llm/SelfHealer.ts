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
    const context = broken.friendlyName
      ? `# CONTEXTE
Tu cherches un élément par sa FONCTION (contexte sémantique) :
  → "${broken.friendlyName}"
Le locator utilisé jusqu'ici — type "${broken.type}", valeur "${broken.value}" —
ne le trouve plus dans la source (tout en bas). Sa valeur technique a pu être
renommée et peut désormais n'avoir AUCUN rapport avec la fonction : ne t'y fie
pas, fie-toi à la FONCTION décrite.

# TÂCHE
Dans la source, trouve l'élément qui remplit CETTE fonction, même si ses
id/classes/attributs sont complètement différents de l'ancien locator. Propose
ensuite des locators alternatifs pour LUI, du plus robuste au moins robuste.
Uniquement des locators réellement présents dans la source, qui désignent UN
SEUL élément.`
      : `# CONTEXTE
Le locator de type "${broken.type}" et de valeur "${broken.value}" est
INTROUVABLE dans la source de la page (tout en bas). Sa valeur est le seul
indice disponible sur l'élément visé.

# TÂCHE
Dans la source, retrouve l'élément que ce locator visait et propose des locators
alternatifs pour LUI, du plus robuste au moins robuste. Uniquement des locators
réellement présents dans la source, qui désignent UN SEUL élément.`;

    return `# RÔLE
Tu répares des locators de test web cassés à partir du HTML de la page.

${context}

# FORMAT
Un objet JSON {"locators": [...]}, chaque entrée {"type", "value", "name"?} :
- "type"  : "role" | "label" | "placeholder" | "text" | "testId" | "altText"
            | "title" | "locator". Privilégie role/label/text à "locator".
- "value" : rôle ARIA pour "role" (ex: "button") ; sélecteur CSS/XPath pour
            "locator" ; sinon le texte/label/placeholder de l'élément.
- "name"  : nom accessible. OBLIGATOIRE pour "role" (sans lui "role":"textbox"
            est ambigu), interdit ailleurs.

# RÈGLES
- Inclus TOUJOURS au moins un locator technique copié EXACTEMENT depuis la
  source quand l'élément a un data-testid ou un id : pour un data-testid, utilise
  {"type":"testId","value":"..."} ; pour un id, {"type":"locator","value":"#id"}.
  C'est l'ancre la plus fiable.
- Pour "text"/"role.name", recopie le texte EXACT visible dans la source, sans
  l'inventer ni le compléter.
- N'utilise PAS "id"/"name"/"css"/"xpath" : passe par {"type":"locator", ...}.
- Aucune explication, aucun commentaire, aucun bloc markdown (pas de \`\`\`).
- Réponds UNIQUEMENT par l'objet JSON brut.

# EXEMPLE
{"locators":[{"type":"role","value":"button","name":"Se connecter"},{"type":"label","value":"Mot de passe"},{"type":"locator","value":"[name='login']"}]}

# SOURCE DE LA PAGE
${pageSource}`;
  }
}
