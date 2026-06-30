/**
 * LLMClient — appelle un LLM local via Ollama (POST /api/generate).
 * Config via .env (OLLAMA_MODEL, OLLAMA_BASE_URL, OLLAMA_TEMPERATURE).
 *
 * @see https://github.com/ollama/ollama/blob/main/docs/api.md
 */

export default class LLMClient {
  private readonly baseUrl: string;

  constructor(
    private readonly model = process.env.OLLAMA_MODEL ?? "llama3.1",
    baseUrl = process.env.OLLAMA_BASE_URL ?? "http://localhost:11434",
    private readonly temperature = Number(process.env.OLLAMA_TEMPERATURE ?? 0),
    // Fenêtre de contexte. Le défaut Ollama (~2048) tronque le HTML d'une vraie
    // page (la frame liste-devis fait ~14k tokens) → l'élément n'atteint jamais
    // le modèle. On la monte pour que la source tienne en entier.
    private readonly numCtx = Number(process.env.OLLAMA_NUM_CTX ?? 16384),
  ) {
    // Tolère un host sans schéma (ex: "127.0.0.1:11434") — fetch exige http(s).
    this.baseUrl = /^https?:\/\//.test(baseUrl) ? baseUrl : `http://${baseUrl}`;
  }

  /** Envoie un prompt, renvoie le texte généré. */
  async complete(prompt: string): Promise<string> {
    return this.generate(prompt, false);
  }

  /** Pareil mais force une sortie JSON et la parse. */
  async completeJson<T = unknown>(prompt: string): Promise<T> {
    return JSON.parse(await this.generate(prompt, true)) as T;
  }

  private async generate(prompt: string, json: boolean): Promise<string> {
    const res = await fetch(`${this.baseUrl}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: this.model,
        prompt,
        stream: false,
        format: json ? "json" : undefined,
        options: { temperature: this.temperature, num_ctx: this.numCtx },
      }),
    });

    if (!res.ok) {
      throw new Error(
        `Ollama a renvoyé ${res.status} (Ollama est-il démarré ?)`,
      );
    }

    const data = (await res.json()) as { response: string };
    return data.response;
  }
}
