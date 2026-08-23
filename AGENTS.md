# Agent Instructions

Production-shaped TypeScript monorepo for the Control Plane: a modular monolith with independently deployable workers and gateways.

## Quick reference

- **Package manager:** Bun (`bun.lock`)
- **Build:** `bun run build`
- **Lint:** `bun run lint`
- **Test:** `bun run test`
- **Format:** `bun run format:check`
- **Toolchain:** `toolchain: auto` in `.github/code-foundry.yml` (native tools, mise only if `.mise.toml` exists)

## Priorities

When instructions conflict: system/user instructions > this file and explicit task scope > nested `AGENTS.md` > project conventions > general best practices. Ask for clarification when a missing decision would materially change the implementation.

## Where to find things

- [`.github/CONTRIBUTING.md`](.github/CONTRIBUTING.md) — branching, safety boundaries, standard workflow, review/merge protocol, completion report format, security procedures
- [`.agents/validation.md`](.agents/validation.md) — validation commands, test/coverage rules, runner constraints
- [`.agents/ci.md`](.agents/ci.md) — GitHub workflow design rules (when editing CI)
- [`.agents/conventions.md`](.agents/conventions.md) — documentation, dependencies, generated files

Nested `AGENTS.md` files and project documentation take precedence for their directory.
