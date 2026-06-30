/**
 * LoginHelper — helper de la page de login VertuoSoft, branché sur le
 * self-healing. On déclare l'inventaire des éléments puis on agit via
 * `this.onPage(...)`. La résolution se répare via le LLM si un sélecteur a
 * dérivé — aucun test n'a à connaître SelfHealer / HealingLocator.
 */
import type { Page } from "@playwright/test";
import BaseHelper from "./BaseHelper";
import { locator, text } from "../core/locators/target";

export default class LoginHelper extends BaseHelper {
  private readonly el = {
    // Broken : le vrai champ s'appelle "login" → déclenche le healing.
    username: locator('[name="username"]', "champ identifiant"),
    password: locator('[name="password"]'),
    submit: text("Se connecter", "bouton de connexion"),
  };

  constructor(page: Page) {
    super(page);
  }

  async fillUsername(value: string): Promise<void> {
    await (await this.onPage(this.el.username)).fill(value);
  }

  async fillPassword(value: string): Promise<void> {
    await (await this.onPage(this.el.password)).fill(value);
  }

  async submit(): Promise<void> {
    await (await this.onPage(this.el.submit)).click();
  }
}
