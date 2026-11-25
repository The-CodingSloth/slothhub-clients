# Changelog

## Unreleased — 2026-11-17

- `search` and `slothhub_recommend_tools` accept `source_availability` (`open_source`, `source_available` or `closed_source`), matching the reviewed source-availability fact; Tools without one never match. It replaces the retired Open Source category. `category` with a parent hub such as `ai` or `dev-tools` also returns Tools filed under its subcategories. Older search indexes without source-availability counts return `capability_unavailable`.
- `slothhub_get_implementation_kit` marks a step not runnable when its package
  manager would find the package in the working directory first (`npx` or
  `bunx` without an exact version or dist-tag, any `pipx run`), with the new
  `run.code` `resolution_depends_on_directory`; limits the `skills`, `jsr` and
  `shadcn` helper exceptions to those npm packages under the programs they were
  checked for; and requires a recorded, current link from a package's registry
  metadata to the Tool before a package named only by an interface row is
  runnable (`run.code` `package_link_unverified`). Runnable steps'
  `run.packages[]` add `basis` and `link`, and the Markdown notes an unverified
  link. ([rule](../../docs/runnable-commands.md))

- Agent readiness in `fetch` and the `slothhub://tool/{slug}` resource links each
  signal's dispute (`agentReadiness.signals[].disputeUrl`) to the Tool's report
  form on slothhub.dev, opened with the signal filled in, instead of an issue
  form in a private repository that public users could not open. The Markdown
  adds a line naming `slothhub_submit_feedback` with the field
  `agentReadiness.<signal id>` for disputes sent without a browser. The field
  and its shape are unchanged.
- `slothhub_get_implementation_kit` marks a step runnable only when it is an
  allowlisted install or run of a package the Tool's own record names
  ([rule](../../docs/runnable-commands.md)). Runnable steps add `run.packages`;
  other steps add `run.code` and `run.part` naming what was not allowed.
- `fetch`, `slothhub_get_implementation_kit` and the `slothhub://tool/{slug}`
  resource label text from the Tool's owner or submitter as untrusted data:
  `editorialContentPolicy: "untrusted_data"` and `untrustedContentFields` on the
  record and kit, `editorialContentPolicy` and `contentPolicyNotice` on the
  `fetch` result, and a policy line plus quote delimiters in Markdown
  ([details](../../docs/untrusted-catalog-content.md)). All changes are additive.
- The package ships one self-contained `dist/index.d.ts` instead of per-module
  declarations that imported the unpublished `@slothhub/domain` package and
  included a test helper. TypeScript consumers now resolve every type.
- The README shows the `npx -y slothhub-mcp-server` host configuration.
- `slothhub_get_implementation_kit` asks which agent host the user has when no
  `host` is given, the Tool has ready MCP setup recipes, and the client declares
  elicitation (protocol 2026-07-28 `input_required`, or the 2025 elicitation
  request on session connections). Only hosts with a ready recipe are offered; a
  declined question or a client without elicitation gets `readyHosts` as before.
- Breaking: remove `slothhub_setup_interface` and `slothhub_get_agent_handoff`.
  `slothhub_get_implementation_kit` now returns `readyHosts` and, with `host`, the
  recipe's merge instructions, standalone file, one-click install link and
  header/environment notices. Rename `slothhub_doctor` to `slothhub_check_status`.
  Discovery lists nine tools and is 25% smaller
 .
- Search and recommend publish closed filter values as JSON Schema enums and type
  `verified`, `last_checked_after`, `destination_health` and `limit`; invalid
  values still return the structured `agent_search_*` errors.
- Add `slothhub_get_implementation_kit`: one Tool's numbered install commands (official before
  community, with source), official agent skills, the MCP setup for a chosen
  host, environment variable names, runtime requirements, code examples that
  cite an official source, and official docs. Deprecated steps are skipped with
  a caution; a host with no ready recipe says so. Each step says whether the CLI
  can run it. Read-only. Discovery now lists eleven tools.
- Add `slothhub_submit_feedback`, the first tool that writes. People and agents report a
  wrong fact, a missing tool, a setup recipe that worked or failed, a server
  problem, or a suggestion. Feedback goes to a private queue; nothing is
  published. Hosted `/mcp` records it in-process with a per-IP limit; stdio posts
  to `{SLOTHHUB_BASE_URL}/api/feedback`. Discovery now lists ten tools.
- Add `slothhub_get_component`. It returns a UI component's source files, usage
  examples, license notice, npm dependencies, props, keyboard and accessibility
  notes, and how to install it: the creator's own command when one is published,
  otherwise `npx shadcn@latest add` from SlothHub's registry at `/r/{slug}.json`.
  Components the registry cannot install say why (`manual` with a reason).
  Oversized components return `component_too_large` with the file list; pass
  `file` to read one file at a time. Discovery now lists nine tools.
- `fetch` returns a decision summary by default: pricing plans with billing cadence and add-ons, license, deployment, runtime requirements, product limits, agent interfaces and official links. `full_detail=true` remains for source evidence, checked dates and feature detail; the summary is about 10 times smaller.
- `slothhub_compare_tools` includes plan prices, billing cadence, add-ons and license terms, and names missing plan prices as a gap.
- `slothhub_doctor` advertises its `networkEnvironment` output, so strict MCP clients accept the result.
- Report `feed_host_blocked` with recovery guidance when SlothHub's host blocks automated traffic.
- Rank multi-word searches by how specific each matched word is in the catalog.

## Unreleased — 2026-11-10

Breaking changes before the first npm publication:

- Reduce public stdio and hosted discovery to eight tools: `search`, `fetch`,
  `slothhub_recommend_tools`, `slothhub_compare_tools`,
  `slothhub_get_alternatives`, `slothhub_setup_interface`,
  `slothhub_get_agent_handoff`, and `slothhub_doctor`.
- Replace `slothhub_search_tools` with filtered, paginated connector `search`;
  `resource_kind` replaces `slothhub_list_mcp_servers` and
  `slothhub_list_agent_skills`. Replace `slothhub_get_tool` with `fetch(id)`;
  concise detail is the default, `full_detail=true` retrieves the full record.
- Remove taxonomy list tools, stack list/get, best list/get, alternatives list,
  and editorial comparison list/get. Existing taxonomy, collection and detail
  resources remain available; use `slothhub_compare_tools` for Tool comparison.
- Point prompts and error recovery only at tools and resources the server still
  offers. Stack and best-of browse prompts read `slothhub://artifact/stacks` or
  `slothhub://artifact/best`, or list `slothhub://stack/{slug}` and
  `slothhub://best/{slug}` entries. The alternatives prompt starts from `search`
  and opens `slothhub_get_alternatives`. Not-found and invalid-slug errors name
  the same paths instead of removed list tools.
- List published editorial comparisons as `slothhub://compare/{slug}` entries in
  the paginated `resources/list`, and add the `slothhub://artifact/compare`
  Markdown hub (`/compare.md`), on stdio and hosted `/mcp`. The comparison
  prompt discovers a slug there, opens it, and falls back to
  `slothhub_compare_tools` when no published comparison matches. A catalog that
  does not advertise comparisons lists none, and reading the hub returns
  `capability_unavailable` with recovery.
- Remove `slothhub_get_implementation_plan` and `slothhub_get_citations`;
  fetch full detail, setup recipes and handoff prompts provide sourced guidance.
- Remove `slothhub_check_tool_assembly`, `slothhub_get_visit_url`, and
  `validate_tool_batch`. Public MCP no longer reads Sanity or offers tracked
  redirect lookup. Batch validation remains an editorial workflow.
- Remove inventory, pin-manifest validation/rendering and decision-receipt
  validation/rendering tools from MCP. Offline utilities remain in the CLI.
- Publish only the public executable and public declarations. The admin bin,
  admin declarations, evaluation artifacts and fixtures are excluded.
  Workspace operators can run `pnpm --filter slothhub-mcp-server admin`;
  `pnpm eval:agents` remains available from the monorepo.
- Move bundled `@slothhub/domain` to development dependencies and restore the
  hosted response ceiling to 256 KiB. Oversized responses still fail explicitly.

Fixes:

- Read the stacks directory (`slothhub://artifact/stacks`) from the catalog's `stacksIndex` entry. It read the per-stack template entry, so every read failed against the published catalog.

## Unreleased

- Drop the "Feature highlights" and "Version note" lines from Tool Markdown output; the catalog no longer defines `featureHighlights` or `versionNotes`. `Content-Signal` always shows the site-wide value. No published Tool carried these values.

- Share feed transport, validation, identity and types through the bundled domain package. Accept only catalog major 33, search-index major 17 and snapshot major 20; unsupported versions report the supported major and client upgrade recovery.

- Read catalog 32 setup facts and `llms_txt`/`mcp_client` interfaces, with Search Index 16 and snapshot 19 compatibility. Validate and render Project Tool pin manifest v3 while preserving valid archived v1/v2 declarations. Release compatible clients before deploying the new feeds.

- Add stdio-only `validate_tool_batch`. It checks a caller-supplied tool batch
  with the Studio batch validator, reads published Tool ids from the public
  dataset without a token, and returns warnings, errors, and exit status.
  Hosted HTTP does not advertise it and it does not write.

- Close rejected HTTP response bodies so failed requests release connections,
  and reject malformed UTF-8 instead of silently changing feed text.

- Share active feed downloads independently of retained cache capacity and
  expiry. Start retained lifetimes after validation, preserve independent
  cancellation, and prevent older catalog fills from replacing newer results.
- Skip unused Markdown rendering when returning JSON search results.

- Accept catalog major 22 with source-authored keyboard shortcuts and code
  comparisons, preserving both sides and diff markers in Markdown. Retain earlier
  catalog majors. Release compatible clients before deploying v22 feeds.

- Accept catalog major 21 and preserve reference-table rows, explicit empty
  defaults, and required/optional permission entries in parsed detail and Markdown.
  Retain earlier catalog majors and independent snapshot/search versions.
  Release compatible clients before deploying v21 feeds.

- Validate and render Project Tool pin manifest v2, including UI component declarations, while retaining v1 imports and reporting the imported version.
- Require Tool lookup artifact v5 for generic registry image keys, independently of catalog v18, and recognize port-qualified image references before namespace parsing.

- Accept catalog major 18 with validated generic container registry interfaces and sourced pull Quickstarts. Retain earlier catalog majors; snapshot major 14 and Search Index major 11 stay independent. Release compatible clients before deploying v18 feeds.

- Accept catalog major 17 while retaining snapshot major 14 and derive editor confirmation links from recipe facts; public JSON omits opaque install links. Keep read-only workflows usable with canonical loopback HTTP Tool profiles while external citations remain HTTPS-only.

- Add read-only recommendations with public search filters, Tool comparisons, implementation plans with optional published stack context, and canonical citations, using the shared CLI workflows. Show host-confirmed Cursor and VS Code remote install actions alongside copy setup.

- Read catalog 16.1 multi-file code examples and labeled terminal variants while
  preserving their source, order, and legacy single-example compatibility.

- Accept catalog major 16 with Makefile, Just, Dockerfile, Nix, INI, PHP, and Swift
  feature snippets and optional placeholder guidance, retaining previous catalog
  majors. Snapshot support stays at majors 1–14 (producer 14.0.0), and search
  support stays at majors 2–11. Distribute updated clients before deploying v16
  feeds; existing package publication gates still apply.

- Retire FAQ discovery and retrieval with the directory MVP. Accept catalog major 11 and snapshot major 12; retain the static JSON transport for core Tool discovery. Upgrade clients before deploying the new catalog major.

- Add hosted-safe `slothhub_check_tool_assembly` so agents can check documented Integration, platform, and Agent Interface overlap across 2-5 public Tools, using the same shared evidence checker as `slothhub assembly`. Input validation precedes authenticated index discovery and fixed Tool detail fetches. Only a confirmed 404 for the requested Tool detail becomes unresolved; index and other fetch failures return `feed_load_error`. Markdown keeps confirmed overlap, conflicts, missing evidence, unresolved Tools, and disclaimers separate, with escaped catalog text and validated canonical Tool citations. The tool never dereferences Integration, evidence, website, or `/go/` URLs, never treats taxonomy, prose, or stack membership as evidence, and returns the versioned domain report in JSON. Public skill guidance is version 1.7.0 and explains the evidence check without claiming runtime compatibility.
- Show checked portability, exit, and directional migration facts in Tool detail output.

- Read optional source-backed lifecycle facts and one latest material upgrade brief in Tool detail feeds. Display checked evidence and inert actions; absent lifecycle data stays absent.

- Accept catalog 8 while retaining earlier majors. Missing Tool alternatives now remain unknown; upgrade clients before feed deployment. Search Index remains 9.

- Include Integrations, security evidence, Tool Fit Guidance, and curated alternatives in `slothhub_get_tool` Markdown. Display limits point to complete JSON output, and missing alternatives remain omitted instead of becoming an empty collection.
- Add official-registry recovery for true catalog misses, filter-empty recovery without external links, and an explicit primary package-registry search filter (`npm`, `pypi`, `crates_io`). Browser, CLI, and MCP share allowlisted destinations and query encoding; no registry is fetched.
- Read Continue Setup Recipes as YAML list entries, with separate standalone metadata and merge guidance. Accept catalog 7.x/search 6.x while retaining earlier supported majors; release clients before feed deployment.
- Read Amp Setup Recipes and ready-host search facts through catalog 6.x/search 5.x, preserving earlier supported majors. Text output names the literal merge root, both local settings paths, and workspace approval; it never changes host configuration.
- Read and render Cline Setup Recipes from catalog 5.x and search index 6.x, retaining earlier supported majors. Use the shared host vocabulary for ready-recipe search; upgrade clients before deploying the new feeds.
- `slothhub_get_tool` displays the copy-only Claude Code HTTP setup command from stored MCP Registry facts, with project-local scope guidance and authentication notices. Missing evidence remains unknown; command recipes are never treated as JSON configuration or executed.

- Add `slothhub_setup_interface` for copy-only per-host Setup Recipe retrieval over stdio and hosted HTTP, with canonical citations, registry provenance, and explicit unavailable/ambiguous/oversized recovery.
- Extend the stdio-only `slothhub_inventory_npm_manifest` tool to PyPI, crates, Go modules, and Brewfiles through the existing domain parsers and byte budgets. Keep the npm name and report compatible, add `ecosystem` and `brewfile` selection, preserve each format's CLI report, and retain hosted rejection, explicit-file admission, and named errors without registry queries or command execution.

- Support Goose setup recipes and ready-host filtering from catalog 3 / Search Index 4, preserving YAML in Markdown code blocks and JSON strings. Keep the YAML runtime external to the ESM bundle; a real stdio initialization test protects startup.
- Keep MCP search and detail renderers on one Markdown escaping implementation, with regression coverage for hostile Tool names/descriptions and unchanged raw JSON, ranking, and pagination.
- Include query-matched Articles and their pagination metadata in `slothhub_search_tools`, with canonical index URLs and escaped Markdown. Tool filters remain Tool-only, both lists share the existing per-page search maximum, and Markdown truncation now names its configured character limit while preserving complete structured results.
- Support Tool lookup artifact 4.0.0 for the expanded `homebrew_formula` key vocabulary. Update older clients before consuming this artifact.

- Add `agent_host` to `slothhub_search_tools` to find Tools with a ready Setup Recipe for an Agent Host. Shared validation reports unsupported hosts and unavailable host metadata; tools with empty or missing host arrays do not match.
- Accept catalog feed 2.x and search index 3.x with optional pricing, retaining support for catalog 1.x and search index 2.x. Unpriced listings remain unpriced in JSON and display “Not listed” in markdown output; pricing filters exclude them.
- Add comparison and alternatives browse prompts on stdio and hosted HTTP. Both guide agents through the existing list/get tools, quote queries as data, and cite canonical editorial URLs. Stdio completions use cached editorial feeds, and all prompt queries share the catalog tools' Unicode-aware query limit and recovery guidance.
- Add comparison and alternatives resource templates on stdio and hosted HTTP, reusing validated detail feeds. Hosted output-limit errors now include the configured and observed byte counts and recovery guidance.

- Accept Tool catalog snapshot version 9 in the shared feed version check while retaining versions 1–8 compatibility. Snapshot v9 omits Article summaries; Article discovery remains in the standalone search index and Article feed. Publish this client update before deploying snapshot v9.

- Remove the catalog updates resource. Browse the catalog’s `/new` page for recent additions.

## Unreleased

- Expand the MCP protocol evaluation beyond search-era tools: `runProtocolEvaluation` now issues one representative `tools/call` per hosted-safe Tool against the fixture catalog — including `slothhub_get_agent_handoff`, `slothhub_list_agent_skills`, `slothhub_list_mcp_servers`, alternatives, comparisons, FAQ, glossary, taxonomy, visit-URL, and diagnostics tools — and fails when a tool is unregistered, returns an error envelope, or stops matching its published output schema; each call's framed size stays measured against the hosted 256 KiB bound. Hosted admission cases now also assert that every hosted-safe tool is admitted while each stdio-only Tool (npm inventory, pin manifests, decision receipts) is rejected with its named stdio recovery message, so the evaluation fails if that recovery behavior disappears. The fixture feed client now serves the catalog index, tools, taxonomy, FAQ, glossary, alternatives, and comparisons feeds required by those tools; `evaluation.xml` stays the search ranking suite unchanged.

- Add `slothhub_list_comparisons` and `slothhub_get_comparison` so agents can page through editorial A-vs-B comparison pairs — or fetch one pair's feature rows, comparison facts, verdict, and source references by slug — over the public `/api/compare.json` and `/api/compare/{slug}.json` feeds; unknown or malformed slugs return `not_found` pointing at the list tool, catalogs that do not advertise `feeds.comparisons` fail `capability_unavailable`, over-budget detail feeds fail `feed_payload_too_large` rather than truncating, and catalog text is escaped in markdown output. Both tools are advertised on stdio and hosted HTTP; no `slothhub://feed/comparisons` resource is registered because the producer embeds full Tool summaries per pair with no item cap, so a framed read cannot be guaranteed under the hosted 256 KiB buffer.
- Generate the `namespace` lists in the `slothhub_get_tool` and `slothhub_get_agent_handoff` descriptions from `TOOL_LOOKUP_NAMESPACE_VALUES`, fixing the `container_image` omission and pinning every advertised namespace with a description-coverage test so a future namespace cannot drift; a `container_image` lookup example is now included.
- Mark stacks that carry a reviewed execution recipe in `slothhub_list_stacks`: JSON summaries gain a positive-only `recipeAvailable: true` and markdown prints "Execution recipe available"; the property is omitted (never `false`) when no recipe is published, recipe bodies stay in `slothhub_get_stack` output, and canonical stack URLs are unchanged.
- Expose the `/best.md` best-of markdown hub as the fixed `slothhub://artifact/best` resource on stdio and hosted HTTP so agents can load the editorial list directory the same way they load `/interfaces.md`; the index must advertise the fixed same-origin path under `markdownArtifacts.bestIndex`, an unadvertised catalog fails `capability_unavailable` pointing at `slothhub_list_best`, and an over-budget artifact fails `feed_text_payload_too_large` rather than truncating. The framed hosted read measures ~0.8 KB against the 256 KiB buffer; `slothhub_list_best` stays the structured list tool.
- Accept 2.x search-index feeds that omit the deprecated `search.tokens` and `search.fields` projections; `search.text` remains the only required haystack and feeds that still emit the projections keep working unchanged.
- Add `slothhub_get_agent_handoff` so agents can fetch the reviewed public handoff prompt composed by the shared domain builder — the same prompt family Tool pages offer for copy-and-paste — as `prompt`, `starterPrompts`, canonical `detailUrl`, optional `markdownUrl`, and a `providerPolicy` summary, resolving aliases and namespaced identities through the same public lookup as `slothhub_get_tool`; oversized prompts fail as `prompt_too_large` with observed/configured bytes and manual-copy recovery instead of truncating, and tracked `/go/` URLs, install commands, and private fields are never returned. The per-prompt 4 KiB domain tripwire bounds the whole response well under the hosted buffer, so the tool is advertised on stdio and hosted HTTP.
- Print public Source References (title, source type, URL, checked date) in `slothhub_get_tool` markdown under a "Source references" heading so agents can cite the evidence behind editorial claims; tracked `/go/` URLs are never rendered, missing or empty collections omit the section, catalog text is escaped, the rendered list is bounded at the domain's `MAX_PUBLIC_SOURCE_REFERENCES` with a JSON pointer for any remainder, and JSON output is unchanged.
- Print the Tool's canonical resource identity (kind, canonical URL, registry ID), taxonomy (categories, tags, use cases), freshness (verified and last-checked timestamps plus destination health), and public resource links in `slothhub_get_tool` markdown; tracked `/go/` URLs are filtered from resource links, catalog text is escaped, empty collections say "none listed," and JSON output is unchanged.
- Print public comparison facts (`bestFor`, `notBestFor`, `strengths`, `limitations`, plus `lastReviewedAt`) in `slothhub_get_tool` markdown output under their own "Comparison facts" heading, distinct from Fit Guidance; empty or missing objects omit the section while JSON keeps the full facts.
- Add `slothhub_list_alternatives` and `slothhub_get_alternatives` tools plus the stdio-only `slothhub://feed/alternatives` resource so agents can page through editorial alternative sets — or fetch one set's alternatives and comparison facts by slug — over the public `/api/alternatives.json` and `/api/alternatives/{slug}.json` feeds; unknown or unauthenticated slugs return `not_found` pointing at the list tool, catalogs that do not advertise the feed fail `capability_unavailable`, and catalog text is escaped in markdown output. Both tools are advertised on stdio and hosted HTTP; the raw index resource stays stdio-only because the producer embeds full Tool summaries per set with no item cap, so a framed read cannot be guaranteed under the hosted 256 KiB buffer.
- Add `slothhub_list_agent_skills` so agents can page through catalog Tools whose resource kind is `agent_skill` — including skill identifiers and install commands from agent interfaces — instead of re-deriving the `resource_kind` search filter; the tool is read-only, paginated, and advertised on stdio and hosted HTTP.
- Add `slothhub_list_faq`, `slothhub_get_faq`, `slothhub_list_glossary`, and `slothhub_get_glossary_term` tools so agents can page through FAQ entries and glossary terms — or fetch one by slug — without downloading the whole feed; catalog text is escaped in markdown output, citations use canonical page URLs (never `/go/`), unknown slugs return `not_found` pointing at the list tool, and a catalog that does not authenticate a leaf feed fails `capability_unavailable`. All four tools are advertised on stdio and hosted HTTP.
- Add stdio-only `slothhub_inventory_npm_manifest` so local MCP clients can map one explicit package.json (path or inline text, 64 KiB bound) to public Sloth Hub Tool identities through the shared inventory contract; hosted HTTP neither advertises nor dispatches it and rejects named calls with a stdio recovery capability error.
- Add stdio-only `slothhub_validate_pin_manifest` and `slothhub_render_pin_manifest` tools that validate and render caller-supplied Project Tool pin manifest JSON through the shared domain parser, preserving the 64 KiB bound, dangerous-key and `/go/` citation rejections, and named failure reasons without echoing rejected content. Hosted HTTP neither advertises nor dispatches them.
- Advertise `slothhub://artifact/interfaces` on the hosted HTTP endpoint; the framed live `resources/read` measures ~1.6 KB against the 256 KiB buffer, and the hosted markdown fetch is bounded at that budget so an over-budget artifact fails as `feed_text_payload_too_large` instead of a generic 502.
- Paginate `resources/list` across the merged fixed, Tool Stack, and best-of inventory with opaque snapshot-bound cursors on a 128 KiB serialized page budget; malformed or stale cursors return `invalid_cursor`/`stale_cursor` invalid params with restart guidance, replacing the silent 150-item per-collection cap.
- Add stdio cached prompt and resource-template completions with explicit overflow metadata; hosted admission remains disabled.

- Fail `resources/list` with a bounded `feed_load_error` protocol error when a collection feed cannot load, preserving genuine empty catalogs and request cancellation.
- Preserve collection payload-limit byte counts in protocol errors, and invalidate the implicated cached index after a feed identity mismatch so an explicit retry can recover.
- Add `slothhub_browse_best` so MCP clients can list editorial best-of lists, open one by slug, and cite the canonical list URL.
- Expose the existing static workflow prompts (`slothhub_discover_tool`,
  `slothhub_find_mcp_server`, `slothhub_find_agent_skill`,
  `slothhub_browse_stack`) on the hosted HTTP MCP
  handler, with bounded quoted arguments and fail-closed unknown names.
- Expose the canonical public `/updates.json` Change feed as a stdio MCP resource, with explicit capability and payload-limit failures.
- List every advertised catalog feed and snapshot in `slothhub_doctor` markdown instead of a hardcoded subset.
- Advertise `slothhub://feed/updates` on the hosted HTTP endpoint; the 50-item producer cap keeps the framed `resources/read` far under the 256 KiB response buffer.
- Add `slothhub_find_agent_skill` so MCP clients can list or search agent skills, then cite `detailUrl`.
- Add `slothhub_list_use_cases` so MCP clients can browse the public use-cases feed before filtering search with `use_case`.
- Add `slothhub_list_tags` so MCP clients can browse the public tags feed the same way they browse categories.
- Share deterministic agent search ranking and fail-closed filter validation with the CLI, backed by offline exact-parity evaluations and named structured limit errors.
- Return `capability_unavailable` when older search feeds lack security or Agent Interface facet metadata.
- Upgrade to the split MCP TypeScript SDK v2 packages.
- Serve the stateless MCP `2026-07-28` protocol over HTTP and stdio while
  retaining initialize-based compatibility with 2025-era clients.
- Add modern discovery, routing-header validation, cache hints, and
  request-stream cancellation behavior.
- Accept compact Tool–Integration evidence in Tool detail and search-index feeds.
- Strip unknown nested Integration fields while preserving the public allowlist.
- Accept Tool feeds at schema `1.2.x` and search-index feeds at schema `2.1.x`.
- Return actionable `unsupported_version` tool errors for incompatible catalog feed majors.

## 0.1.0

- Prepare the MCP server package for its first provenance-enabled npm release.
