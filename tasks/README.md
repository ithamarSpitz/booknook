# Tasks

`tasks/roadmap.yaml` is the executable task graph consumed by the harness.

```text
S0-contract   Stage 1: S0-T1 contract                       -> stop for human review
S1-build      Stage 1: S1-T1 database, S1-T2 add-book/book-details, S1-T3 recommendations fn,
                       S1-T4 app shell, S1-T5 README         (parallel)
              Stage 2: S1-T6 login+settings, S1-T7 recs screen, S1-T8 add-book screen,
                       S1-T9 first run+PWA                   (parallel)
              Stage 3: S1-T10 integration gate (live APIs)
S2-release    Stage 1: S2-T1 deploy prep (actual deploy is manual, see docs/deploy.md)
```

Only S1-T1, the S1 stage barriers and S1-T10 touch the shared local Supabase stack.
After S0 is approved, add `docs/contract.md` and `supabase/functions/_shared/types.ts` to `paths.protected` in `harness.yaml`.

The `demo` sprint exists only for harness self-testing.
