# Contributing

Formation Chat Core is being built contract first. A change to observable API behavior starts with
the protocol definition and tests, followed by the server or client implementation.

## Development flow

1. Choose one task from `docs/IMPLEMENTATION_PLAN.md`.
2. Confirm its dependencies are complete.
3. Create a short-lived branch.
4. Implement the smallest working vertical slice.
5. Run its verification steps.
6. Commit one logical change at a time.
7. Update documentation in the same change when public behavior changes.

## Commit messages

Use `<type>: <short description>`, for example:

```text
docs: record conversation ownership boundary
feat: add anonymous session bootstrap contract
test: cover SSE replay after reconnect
```

## Architecture changes

Do not silently reverse an accepted decision. Add a new ADR that explains the new context,
decision, alternatives, and migration consequences.
