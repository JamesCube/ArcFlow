# Documentation standards and maintenance

<a id="zh"></a>
<a id="en"></a>
<a id="简体中文"></a>
<a id="english"></a>

[简体中文](DOCUMENTATION_STANDARD.md) · [Documentation](README.en.md)

This standard applies to maintained repository documentation and API material. Readers should find the right version, complete a task, inspect a contract, and understand what the evidence establishes. Historical sources retain their original bytes with localized explanations of scope.

<!-- topic:languages-and-naming -->
## Languages and naming

- Simplified Chinese retains `NAME.md`; English uses `NAME.en.md` beside it. Indexes use `README.md`/`README.en.md`. Preserve established stable names rather than renaming paths just for case consistency.
- One localized title and one primary language per page, with direct counterpart/index links at the top. Keep technical identifiers, fields, test names, and exact evidence unchanged where necessary.
- Cover equivalent topics, fields, prerequisites, steps, commands, outcomes, risks, and sources. Natural phrasing is encouraged; matching sentence lengths is not required. A summary is not a full counterpart.
- Language navigation points directly to paired files. Legacy `#zh`, `#en`, `#简体中文`, and `#english` may remain as switch anchors. Preserve old section fragments with explicit anchors or valid destinations.
- `documentation-map.json` registers the default Chinese path, category, and stable topic IDs. Both files use matching `<!-- topic:identifier -->` markers; maintain them together when reorganizing.

<!-- topic:page-types-and-organization -->
## Page types and organization

- **Tutorial:** lead a reader from an initial state through a verifiable journey.
- **How-to:** necessary steps, prerequisites, and recovery for a known goal.
- **Explanation:** design, trade-offs, boundaries, and alternatives.
- **Reference:** exact fields, types, limits, states, errors, compatibility, and sources.
- **History:** implementation or acceptance at a fixed revision/date/environment.
- **Index:** task-based navigation without copying full contracts.

Express categories in indexes before moving stable files. A page may include supporting material but needs one primary purpose. Design discussion cannot replace commands, and test results cannot replace usage instructions.

<!-- topic:reusable-structures-where-useful -->
## Reusable structures, where useful

Start with a title and concise scope identifying audience, subject, and applicable version. Add only relevant sections:

1. Run/operate: prerequisites → procedure → observable outcomes → failures/recovery → next steps.
2. API/data reference: route/type → identity/permissions → fields/limits → responses/errors → retries/concurrency → storage compatibility → sources/verification.
3. Design: problem → choice and rationale → boundaries → extension points and related contracts.
4. Evidence: date/exact commit/tree/environment → executed commands/results → failed/skipped/unrun checks → original artifacts → remaining gates.

Do not force a procedure into a field reference or invent expected outcomes for history. Prefer short paragraphs, tables with units/types, and executable commands. Put working directory and prerequisites before commands.

<!-- topic:sources-of-truth-and-versions -->
## Sources of truth and versions

- Current behavior comes from the corresponding code, configuration, controllers/DTOs, explicit catalog, and executable tests. A README, diagram, or proposal cannot define an unimplemented endpoint.
- Distinguish Java artifact version, release tag, definition schema, JSON wrapper, SQL revision, and business documentVersion. Current main is not a historical alpha release; unchanged SQL does not make older binaries understand new payloads.
- API references, OpenAPI, endpoint inventories, and request examples must match actual routes, validation, and envelopes. Update them together. Offline specifications do not imply deployed Swagger UI or new routes.
- Separate current scope from historical checks. Preserve actual failures, skips, blockers, and counts. H2 is not PostgreSQL/MySQL; DOM/HTTP is not browser evidence; screenshots do not establish transactions or security.
- Captures link to unchanged real images and per-image commit/run/hash. Language variants are not distinct business states. Source, CI, merge, publication, deployment, and production acceptance are different claims.
- Date external dependency-maintenance assertions and link official sources. Without a new check, do not change the date or silently reuse an outdated “current” claim.

<!-- topic:editing-and-translation-workflow -->
## Editing and translation workflow

Identify the source revision and affected contracts, then update both languages, indexes, topic registration, examples, and relevant specifications. Preserve commands/code and identifiers. When correcting an old assertion, distinguish its checkpoint from current scope rather than rewriting historical outcomes. Compare every number, negative condition, required field, bound, error, and recovery risk.

A new page needs a primary type and a useful next destination. Do not translate over archived source bytes; register them under the [archive rules](history/README.en.md), with equal localized context and access paths. Documentation work alone does not authorize publication, merge, deployment, or behavior changes.

<!-- topic:before-submitting -->
## Before submitting

- Align topics and key contracts, with no missing sections, broken links, or stacked language prose.
- Check relative paths, anchors, images, source links, and same-language navigation.
- State working directories, tools, data retention/cleanup, and side effects. Include no real credentials or personal data.
- Run repository documentation checks and affected API/example validation. Report actual scope; a checklist is not a passing result.
- Review writing, versions, and boundaries manually. Automated topic/link checks detect structural gaps but cannot establish translation accuracy or technical correctness.

[Documentation](README.en.md) · [Developer guide](development/README.en.md) · [API reference](api/API_REFERENCE.en.md)
