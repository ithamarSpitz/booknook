# Torimitor architecture

Authoritative technical design. Agents must not edit this file or `docs/architecture/**`; changes go through the harness plan-change flow.

| Module | Alias | Covers |
|---|---|---|
| `docs/architecture/overview.md` | `architecture.overview` | components, runtime, repository layout, invariants |
| `docs/architecture/data-model.md` | `architecture.data_model` | tables, columns, RLS, triggers, RPCs |
| `docs/architecture/functions.md` | `architecture.functions` | Edge Functions, inputs, outputs, behavior |
| `docs/architecture/matching.md` | `architecture.matching` | Hebrew ↔ original title resolution and localization |
| `docs/architecture/frontend.md` | `architecture.frontend` | web app structure, screens, file ownership |
| `docs/architecture/testing.md` | `architecture.testing` | test layers, shared Supabase stack rules |

After sprint `S0-contract` is approved, `docs/contract.md` and `supabase/functions/_shared/types.ts` are the binding interface between lanes.
