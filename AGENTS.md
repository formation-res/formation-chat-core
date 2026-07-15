# Agent working agreement

Read these files before changing code:

1. `docs/PROJECT_BRIEF.md`
2. `docs/IMPLEMENTATION_PLAN.md`
3. every accepted ADR in `docs/decisions/`

## Working rules

- Keep the chat core independent of Haystack, model vendors, and UI frameworks.
- Define or update the public contract before implementing a public behavior.
- Use OpenAPI 3.1 and JSON Schema for language-neutral boundaries.
- Treat the chat core as the canonical store for web-chat conversations.
- Store agent execution details separately from public transcript content.
- Make public, operator, and internal event visibility explicit.
- Use ordinary HTTP for writes and SSE for streaming in v1.
- Require idempotency keys for retryable writes.
- Preserve tenant and site isolation in every query and mutation.
- Add an ADR before changing an accepted architectural decision.
- Work in small vertical slices. Keep the repository buildable after each slice.
- Do not add a full operator inbox, multi-agent orchestration, or anonymous cross-device recovery
  during v1 unless the project brief is explicitly revised.

## Before handing work off

- Run the relevant tests, type checking, linting, and build.
- Check the staged diff for credentials and personal data.
- Update the implementation plan when a task is completed or materially changed.
- Document any new public endpoint, event, or connector behavior with the code.
- State what changed, what remains, and any decision the next session must make.
