import { test, expect } from "@playwright/test";
import LLMClient from "../src/core/llm/LLMClient";

// Vérifie qu'on peut appeler le LLM local (Ollama doit tourner + modèle pull).
// cf. fin de la vidéo "understanding-self-healing-components".
test("LLMClient appelle Ollama en local", async () => {
  // Le 1er appel charge le modèle en mémoire (cold start) → marge large.
  test.setTimeout(120_000);
  const llm = new LLMClient();
  const response = await llm.complete('Réponds uniquement par le mot "pong".');
  console.log("Réponse LLM:", response);
  expect(response.trim().length).toBeGreaterThan(0);
});
