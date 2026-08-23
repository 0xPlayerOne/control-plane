# Documentation, dependencies, and generated files

Rules for documentation, dependency management, and generated artifacts. Applies when editing docs, adding dependencies, or producing build output.

## Documentation

- Update documentation when behavior, setup, configuration, commands, or operational procedures change.
- Keep `.env.example` limited to variable names and safe placeholders.
- Preserve formatting and line-ending conventions from `.editorconfig` and `.gitattributes`.

## Dependencies

- Use the package manager indicated by the existing lockfile (`bun.lock` → Bun). Do not mix package managers or regenerate lockfiles as a side effect.
- Keep dependency additions narrowly scoped and explain security, licensing, and runtime impact.
- Prefer a version published at least 7 days ago. Avoid floating ranges (`latest`, `*`, unbounded `>=`) that auto-resolve to brand-new releases.

## Generated files

- Do not commit build output, caches, coverage output, dependency directories, generated credentials, or temporary files.
- Do not commit secrets, credentials, tokens, private keys, local environment files, or machine-specific paths.
