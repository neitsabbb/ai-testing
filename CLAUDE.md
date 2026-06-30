# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

An **AI-driven test-automation learning playground**. The goal is to rebuild a testing
repo from scratch following the methodology of the Udemy course _"AI Test Automation with
Selenium, Playwright & LLMs"_ (Karthik) — but applied to **Playwright + TypeScript**, the
stack Vertuoza actually uses, rather than the course's Selenium/C#/.NET.

This is a **sandbox to practice the techniques**, not a replacement for the production QA
framework. Keep it self-contained and experimental.

**Current status: self-healing layer complete + applied to an end-to-end quote example.**
The Playwright + TS toolchain is scaffolded and the four self-healing components from the
course's plan are built bottom-up:

- (a) ✅ **Talk to the LLM** — `src/core/llm/LLMClient.ts` calls a local Ollama model
  (`POST /api/generate`), config via `.env` (`OLLAMA_*`). Covered by `tests/llm.spec.ts`.
- (b)/(c) ✅ **Format the prompt + parse the response** — `src/core/llm/SelfHealer.ts` passes the
  broken locator (type + value) and the page's HTML to the LLM and returns alternative
  locators in the Playwright `getBy*` vocabulary (testId, role, label, placeholder, text,
  css/xpath) as strict JSON. Covered by `tests/self-healer.spec.ts`.
- (d) ✅ **Heal the running test** — `src/core/healing/HealingLocator.ts` is the runtime "LOCATOR
  STRATEGY": try the original locator → try cached alternatives → call `SelfHealer` with the
  live DOM → retry → cache the working alternative in `src/core/healing/LocatorCache.ts` (a JSON
  file, the diagram's "DB cylinder"). No test code is edited; the run self-heals. Covered by
  `tests/healing-locator.spec.ts` and `tests/iframe-healing.spec.ts`.

The locator vocabulary lives in `src/core/locators/` (`target.ts` = `ElementTarget` builders

- `STRATEGY_PRIORITY`; `resolve.ts` = `buildLocator`). Page Objects sit in `src/helpers/`
  and extend `BaseHelper`, which exposes self-healing accessors (`onPage`/`inFrame`) and raw,
  no-heal accessors (`onPageRaw`/`inFrameRaw`, used for readiness `waitFor`s that must not
  trigger an LLM call).

**End-to-end example — `tests/qa-quote-self-healing.spec.ts`.** Drives the real VertuoSoft QA
app to create a quote ("devis") from scratch, modeled on turing's `fillMandatoryQuoteFieldsV3`:
login → open "Nouveau devis" → fill reference/client/VAT/payment-terms → add one free-item
line → submit → assert the quote appears in the grid with status "A envoyer". It deliberately
breaks **three** locators to exercise healing at three levels — on the page (`LoginHelper`
username), in the list iframe `#quotesListIframe` (`QuotePageHelper` new-quote button), and
in the form iframe `#quoteUpdate` (`QuoteFormHelper` reference field). The `beforeEach` wipes
the locator cache so each run heals cold. Needs `BASE_URL`/`EMAIL`/`PASSWORD` env + Ollama;
timeout is raised to 300 s for the cold LLM calls.

Commands (run from `ai-testing/`):

| Command                          | What it does                                               |
| -------------------------------- | ---------------------------------------------------------- |
| `npm run test`                   | Run the Playwright suite (`tests/`). Needs Ollama running. |
| `npm run test:ui` / `test:debug` | Playwright UI / debug runners.                             |
| `npm run typecheck`              | `tsc --noEmit`.                                            |
| `npm run codegen`                | Playwright codegen.                                        |

The LLM tests need a local Ollama (`OLLAMA_BASE_URL`, default `http://localhost:11434`) with
the `.env` model pulled (currently `qwen2.5-coder:7b`). Do not invent commands that don't
exist; keep this table in sync with `package.json`.

## Context: the surrounding Vertuoza repos

This repo lives at `~/Vertuoza/ai-testing`, alongside two sibling repos that are the
reference points for everything built here:

- **`../vertuo-front`** — the application under test: **VertuoSoft**, a construction-management
  web app (Next.js + Bun + TypeScript). Tests target its QA environment.
- **`../turing`** — the _existing_, mature QA framework (Playwright + TypeScript). When you
  need a proven convention — Page Object Model layout, GraphQL codegen, Allure reporting,
  SOPS-encrypted env, project-based test isolation via `test-files.json` — look there first
  and borrow rather than reinvent. This playground is free to deviate, but turing is the
  "how Vertuoza already does it" baseline.

## The course methodology (the core of this repo)

The repo follows the conceptual progression of the course (Selenium/C#/.NET → translated to
Playwright/TS). The steps build on each other:

1. **Prompt engineering** — why how you ask matters.
2. **Context engineering** — the central idea. Quality of LLM output is driven by how you
   _structure the information you feed it_: system prompts, conversation history, RAG /
   requirement docs, structured context files, real-time environment access, and asking for
   output in a guided format (e.g. JSON).
3. **AI agents** — agents = LLM + tools that _act_ on the world; tools are the key primitive,
   and **MCP** is the open standard for connecting an LLM to them.
4. **Playwright MCP server** — the main tool here: it lets the LLM drive a real browser
   (navigate, inspect, fill forms, screenshot) to gather live context and generate tests.
5. **Vibe-code manual testing** — step 1 of test generation: point an agent (+ Playwright MCP)
   at the app and have it explore and produce a `test-case.md` of manual cases (positive +
   negative permutations).
6. **Vibe-code automatic testing** — step 2: feed that `test-case.md` back as _context_ to
   generate a full automated framework (Page Object Model, config, waits, reusable helpers).
   One good context file produces a large, coherent codebase.
7. **Vibe-code BDD scenarios** — step 3: from the same `test-case.md` + generated tests,
   produce BDD/Gherkin feature files and step definitions.
8. **Traditional automation problems** — what self-healing solves: a single changed/stale
   locator breaks an entire traditional suite.
9. **AI self-healing** — the solution: same test code, but locators carry _friendly names_;
   when a locator breaks, an LLM (local via Ollama, or cloud) finds a working alternative at
   runtime. Trade-off: self-healing runs are markedly slower than static ones — acceptable
   cost for resilience.
10. **Self-healing components** — the build plan: (a) talk to the LLM, (b) format the prompt,
    (c) parse the response, (d) update the locators in the running test.
11. **Prompting for alternative locators** — pass the page source to the LLM and ask for
    alternative locators as strict JSON, refining the prompt for consistent output.

### The end-to-end workflow this methodology describes

```
Playwright MCP explores the live app
        │
        ▼
  test-case.md  ◄── the reusable "context" artifact; everything downstream reads it
        │
        ├──► generated Playwright + TS test framework (Page Object Model)
        └──► BDD feature files + step definitions
                  │
                  ▼
        self-healing layer: friendly-named locators → on break, LLM returns
        alternative locators as JSON → test continues without a code change
```

Two ideas underpin all of it and should guide any test code generated here:

- **Context engineering over raw prompting** — invest in the context file / page source /
  requirements you hand the model; that, not clever phrasing, is what produces good output.
- **Self-healing locators** — locators are expected to drift; design Page Objects with
  human-readable intent (a "friendly name") so an LLM can recover when a selector breaks.
