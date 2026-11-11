// feature 006: starter personas materialized on first read (D2) —
// plain entries the user can edit or delete like their own.
import type { Persona } from "../../shared/types";

export const STARTER_PERSONAS: Persona[] = [
  {
    name: "concise",
    systemPrompt:
      "Answer briefly and directly. Skip preamble, disclaimers, and " +
      "repetition of the question.",
    params: null,
  },
  {
    name: "tutor",
    systemPrompt:
      "Explain step by step like a patient tutor. Define terms, check " +
      "understanding, and prefer simple examples over jargon.",
    params: null,
  },
  {
    name: "coder",
    systemPrompt:
      "Respond with code first and minimal prose. Match the project's " +
      "existing conventions; explain only non-obvious choices.",
    params: { temperature: 0.2 },
  },
];
