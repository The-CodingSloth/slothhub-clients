# Changelog

## Unreleased

- Add `--source-availability <open_source|source_available|closed_source>` to `search` and `recommend`. It matches the reviewed `deployment.sourceAvailability` fact; Tools without one never match. It replaces the retired Open Source category. `--category` with a parent hub such as `ai` or `dev-tools` now also returns Tools filed under its subcategories.
- `implement --run` no longer runs a step whose package manager would find the
  package in the working directory before the registry: `npx <name>` without an
  exact version or dist-tag, `npx <name>@<range>`, `bunx <name>` without one, and
  every `pipx run` (which runs a file of that name in the current folder first).
  These steps are still listed, with the new refusal code
  `resolution_depends_on_directory` and the form to use instead
  (`npx <name>@latest`, `pnpm dlx <name>`, `pipx install <name>`). `pnpm dlx`,
  `yarn dlx` and `uvx` resolve from the registry and run as before.
- The `skills`, `jsr` and `shadcn` helper exceptions hold only for those npm
  packages under the programs they were checked for (`skills`: `npx`,
  `pnpm dlx`, `yarn dlx`, `bunx`; `jsr`: `npx`; `shadcn`: `npx`, `pnpm dlx`).
  `uvx skills add …` and similar no longer pass, because under a Python runner
  the same name is an unrelated PyPI package.
- A package named only by one of the listing's interface rows, not by the
  Tool's resource identity, runs only when a registry check has recorded, within
  the last seven days, that the package's own registry metadata links to the
  Tool's repository or site. Otherwise the step is refused with
  `package_link_unverified` and its `refusal.part` names the package. Runnable
  steps' `run.packages[]` add `basis` (`resource_identity`, `agent_interface` or
  `component`) and `link` (`verified`, `missing`, `stale`, `mismatch` or
  `not_required`); text output notes an unverified link.
  ([rule, program behavior and measurement](../../docs/runnable-commands.md))

- The default Project Tool pin manifest file is now `slothhub.tools.json`, with
  the same two h's as the domain; the old `slothub.tools.json` spelled the
  look-alike domain. `manifest init` writes only the new name and refuses
  (`EEXIST`, with the rename command) when only an old-name file exists, so a
  project never ends up with two manifests. `manifest validate` and
  `manifest render` take the file as optional: with none they read
  `slothhub.tools.json`, or the old name when the new one is absent, and print a
  notice with the `mv` command (a `notice` field with `--json`, beside the new
  `path` field). When both exist they read the new name and say the old file was
  not read. Naming an old-name file explicitly also prints the notice. A missing
  default file fails with `manifest_not_found`.
- Agent readiness output links each signal's dispute to the Tool's report form
  on slothhub.dev instead of an issue form in a private repository, and adds a
  line naming `slothhub feedback wrong-fact` for disputes without a browser.
- The manifest reader refuses tracked `/go/` citations on any Vercel deployment
  whose name starts with `sloth` instead of on a list of project names, so the
  package no longer carries internal names. Every previously refused origin is
  still refused.
- `implement --run` runs a step only when it is an allowlisted install or run of
  a package the Tool's own record names: no `npx -c`, `npm exec`, `config set`,
  scripts, URL, Git, path or other-registry sources, and no package the Tool
  does not name ([rule and measurement](../../docs/runnable-commands.md)). A
  refused step returns `step_not_runnable` (exit `2`, previously
  `invalid_input`) with `step`, `refusal.code` and `refusal.part`. The prompt and
  `confirmation_required` show the exact argument vector that runs, through the
  terminal-safety filter; `confirmation_required` adds `steps[].argv` and `ran[]`
  adds `argv`. The kit listing names each refusal code.
- `tool`, `tool --summary`, `tool --json` and `implement` output label text from
  the Tool's owner or submitter as untrusted data: JSON adds
  `editorialContentPolicy: "untrusted_data"` and `untrustedContentFields`, and
  text output adds a policy line and quote delimiters around descriptions,
  features, examples and install steps.
- The package ships one self-contained `dist/index.d.ts`. TypeScript consumers of
  the library entry no longer see `Cannot find module '@slothhub/domain/...'`.
- A feed failure against the default origin names `https://slothhub.dev`, and
  feed failure output prints the recovery, which names `--base-url` and
  `SLOTHHUB_BASE_URL`. A configured origin is still kept out of error text.
- The README leads with the npm install and `npx` commands.
- Breaking: distinguish failures by exit code. Not found exits `3`, confirmation
  required or declined exits `4`, and network, timeout and rate-limit failures exit
  `5`; invalid input stays `2` and other runtime failures stay `1`.
- Help leads with examples, and a mistyped command suggests the closest one.
- Add `implement <slug>` with `--host`, `--run <steps>` and `--yes`. It prints the
  implementation kit; `--run` executes only plain package-manager commands (npm,
  npx, pnpm, yarn, bun, bunx, uv, uvx, pip, pipx) without a shell, after a
  confirmation prompt or `--yes`, and stops at the first failure. Commands that
  need a shell are never run.
- Add `feedback <kind> <message>` with `--tool`, `--field`, `--evidence`,
  `--query`, `--host` and `--as human|agent`. Feedback goes to a private queue
  for the SlothHub team; invalid input is rejected before anything is sent.
- Add `component <slug>`: print a UI component's files, license notice, npm
  dependencies and install command (`npx shadcn@latest add` from SlothHub's
  registry when the creator publishes none). `--json` returns the same handoff
  as the MCP `slothhub_get_component` tool. Nothing is installed or written.
- Add `tool <slug> --summary` for decision facts only: pricing plans with billing cadence and add-ons, license, deployment, runtime requirements, product limits, agent interfaces and official links, without source evidence. It is about 10 times smaller than full detail.
- `compare` now includes each Tool's plan prices, billing cadence, add-ons and license terms, and names missing plan prices as a gap.
- Report `feed_host_blocked` with recovery guidance when SlothHub's host blocks automated traffic, instead of a generic transport failure. Transport failures now include the HTTP status.
- Rank multi-word searches by how specific each matched word is in the catalog, so `postgres hosting` ranks Postgres tools above Tools that only mention hosting.

- Drop the "Feature highlights" and "Version note" lines from tool output; the catalog no longer defines `featureHighlights` or `versionNotes`. `Content-Signal` always shows the site-wide value. No published Tool carried these values.

- Share feed transport, validation, identity and types through the bundled domain package. Accept only catalog major 33, search-index major 17 and snapshot major 20; unsupported versions report the supported major and client upgrade recovery.

- Simplify discovery around search, tool, recommend, compare, alternatives, setup,
  and doctor. Move assembly, manifest, receipt, and completion into More commands.
  Show common options in top-level help and complete filters in search help;
  list exact identifier namespaces only in tool help. Add search --kind as the
  concise alias for --resource-kind.
- Remove open (use tool for canonical sources), feeds (use doctor), mcp-servers
  and skills (use search --kind mcp-server or agent-skill), categories, tags,
  use-cases (use search filters), catalog (use the public JSON transport),
  comparisons (use compare), best and stack (use editorial web pages), implement
  (use tool and setup), cite and handoff (use tool), and inventory (use manifest
  init --from-inventory for package.json). Removed commands fail as invalid_input.
- Bundle the domain package without a runtime workspace dependency. Exclude
  declaration maps from npm packages while preserving library declarations.
  Remove retired command options --ndjson, --stack, --ecosystem, and --brewfile.

- Read catalog 32 setup facts and `llms_txt`/`mcp_client` interfaces, with Search Index 16 and snapshot 19 compatibility. Write Project Tool pin manifest v3 and keep valid archived v1/v2 declarations readable. Older clients require an upgrade for these new contract versions.

- Authenticate leaf hashes and revisions even when disk persistence is disabled.
  Accept IPv6 loopback development origins. Reject non-regular, changing, and
  invalid UTF-8 cache files without blocking startup. Keep unavailable-index
  errors distinct from missing Tools and successful assembly results.

- Keep help's small bundle independent of feed, setup, and inventory code.
  Honor operation cancellation before serving cached results, and revalidate
  embedded catalog revisions when reading persisted feeds.

- Store cached feeds in separate atomic files so reading one artifact avoids
  parsing the whole cache. Preserve index authentication and existing eviction
  budgets; refresh the older combined cache automatically. Recover malformed
  cached detail metadata from a freshly validated response.

- Accept catalog major 22 with source-authored keyboard shortcuts and code
  comparisons, preserving both sides and diff markers. Retain earlier catalog
  majors. Release compatible clients before deploying v22 feeds.

- Accept catalog major 21 and preserve reference-table rows, explicit empty
  defaults, and required/optional permission entries in parsed detail and output.
  Retain earlier catalog majors and independent snapshot/search versions.
  Release compatible clients before deploying v21 feeds.

- Write Project Tool pin manifest v2 so UI components have an explicit contract version. Continue validating and rendering checked-in v1 manifests offline.
- Require Tool lookup artifact v5 for generic registry image keys, independently of catalog v18, and recognize port-qualified image references before namespace parsing.

- Accept catalog major 18 with validated generic container registry interfaces and sourced pull Quickstarts. Retain earlier catalog majors; snapshot major 14 and Search Index major 11 stay independent. Release compatible clients before deploying v18 feeds.

- Accept catalog major 17 while retaining snapshot major 14 and derive editor confirmation links from recipe facts; public JSON omits opaque install links. Keep read-only workflows usable with canonical loopback HTTP Tool profiles while external citations remain HTTPS-only.

- Preserve sourced quickstarts and explicit missing-quickstart guidance in implementation plans, using the shared CLI/MCP workflow implementation. Show host-confirmed Cursor and VS Code remote install actions alongside copy setup.

- Read catalog 16.1 multi-file code examples and labeled terminal variants while
  preserving their source, order, and legacy single-example compatibility.

- Accept catalog major 16 with Makefile, Just, Dockerfile, Nix, INI, PHP, and Swift
  feature snippets and optional placeholder guidance, retaining previous catalog
  majors. Snapshot support stays at majors 1–14 (producer 14.0.0), and search
  support stays at majors 2–11. Distribute updated clients before deploying v16
  feeds; existing package publication gates still apply.

- Retire FAQ discovery and retrieval with the directory MVP. Accept catalog major 11 and snapshot major 12; retain the static JSON transport for core Tool discovery. Upgrade clients before deploying the new catalog major.

- Return structured visit metadata for `open --json`, show command and subcommand help, and advertise `--version`.

- Include Resource kind and Agent interface kinds in `slothhub compare` output: the criteria list gains "Resource kind" and, when at least one compared Tool publishes interfaces, "Agent interfaces"; each Tool carries its Resource Kind label plus a deduplicated `agentInterfaceKinds` array from the shared searchable-kinds projection (deprecated and non-actionable interfaces excluded), and Tools with no published interfaces report a missing-fact gap rather than implying no agent support.
- Show checked portability, exit, and directional migration facts in Tool detail output.

- Read optional source-backed lifecycle facts and one latest material upgrade brief in Tool detail feeds. Display checked evidence and inert actions; absent lifecycle data stays absent.

- Accept Tool catalog snapshot version 9 in the shared feed version check while retaining versions 1–8 compatibility. Snapshot v9 omits Article summaries; Article discovery remains in the standalone search index and Article feed. Publish this client update before deploying snapshot v9.
- Accept catalog 8 while retaining earlier majors. Missing Tool alternatives now remain unknown; upgrade clients before feed deployment. Search Index remains 9.

- Show Integrations, security evidence, Tool Fit Guidance, and curated alternatives in `slothhub tool`, with explicit display limits and complete JSON output. Missing collections remain unknown; empty collections say none listed.
- Add official-registry recovery for true catalog misses, filter-empty recovery without external links, and an explicit primary package-registry search filter (`npm`, `pypi`, `crates_io`). Browser, CLI, and MCP share allowlisted destinations and query encoding; no registry is fetched.
- Read Continue Setup Recipes as YAML list entries, with separate standalone metadata and merge guidance. Accept catalog 7.x/search 6.x while retaining earlier supported majors; release clients before feed deployment.
- Add copy-only Amp Setup Recipes with the literal `amp.mcpServers` merge root and workspace approval guidance. Accept catalog 6.x/search 5.x while retaining earlier supported majors; update clients before feed deployment.
- Read Cline Setup Recipes with their required Streamable HTTP transport and documented IDE/CLI locations. Accept catalog 5.x and search index 6.x while retaining earlier supported majors. Upgrade clients before deploying the expanded closed host vocabulary.
- `slothhub tool` displays the copy-only Claude Code HTTP setup command from stored MCP Registry facts, with project-local scope guidance and authentication notices. Missing evidence remains unknown; command recipes are never treated as JSON configuration or executed.
- Add `faq`, `glossary`, and `catalog` commands with citations and complete JSON output.
- Stream `catalog --ndjson` through an asynchronous writer with backpressure, bounded reads/writes, explicit partial-output failures, and shared MCP transport limits.
- Print editorial comparison facts and notes in comparison and alternatives detail output, and preserve per-alternative facts in JSON. Tool detail output uses the same fact formatter, including pricing, platform, and migration notes.
- Support `setup --host goose` and `--agent-host goose` with copy-only YAML from catalog 3 / Search Index 4. Keep the YAML runtime external to the ESM bundle so the installed CLI starts correctly.
- Add `slothhub setup --host <agent-host> <slug>` to print one copy-only Setup Recipe from the existing Tool detail feed, with structured unavailable reasons and recovery URLs. Unknown hosts fail before fetching. The command shares the `tool` recipe renderer and never installs, executes, or writes host config.
- Include query-matched Articles from the existing search index beside Tool results, with canonical citation URLs, independent pagination, and an Articles section in human output. Search now accepts `--offset`; the Article page cap reuses the existing maximum of 50 and is explicit in output. Tool filters remain Tool-only and older indexes without Articles stay compatible.
- Support Tool lookup artifact 4.0.0 for the expanded `homebrew_formula` key vocabulary. Update older clients before consuming this artifact.

- Add `--agent-host` to search and recommendation filters, using the shared Agent Host vocabulary and ready Setup Recipe facts. Unsupported hosts fail before a feed request; older feeds without host metadata explain how to recover. Help and shell completions include the filter.
- Accept catalog feed 2.x and search index 3.x with optional pricing, retaining support for catalog 1.x and search index 2.x. Unpriced listings remain unpriced in JSON and display “Not listed” in text output.

- Extend `slothhub inventory` to PyPI and crates: `--ecosystem npm|pypi|crates` selects the dependency ecosystem explicitly, and when the flag is absent `pyproject.toml` and `Cargo.toml` basenames select `pypi` and `crates` while every other name keeps the npm `package.json` behavior. Both TOML ecosystems emit the same report shape as the npm inventory, read only allowlisted dependency tables from one bounded file or stdin, never inspect dependency values or follow path/workspace references, and lockfiles, glob paths, and unrecognized `.toml` names fail before the file is read with structured errors.
- `slothhub inventory --brewfile <Brewfile|->` maps one bounded Brewfile through public `homebrew_formula` Tool lookup keys: only quoted `brew "name"` / `brew 'name'` declarations are read, `cask`/`tap`/`mas`/`system`/`load` lines are ignored, and the report reuses the matched/aliased/retired/unknown/unsupported/capability_unavailable state contract.

- Name the supported `namespace:value` lookup namespaces in `slothhub tool` and `slothhub handoff` help, generated from the shared `TOOL_LOOKUP_NAMESPACE_VALUES` enum so the list cannot drift when a namespace is added.
- Mark stacks that carry a reviewed execution recipe in `slothhub stack` list mode: `--json` items gain a positive-only `recipeAvailable: true` and human output prints "Execution recipe available"; the property is omitted (never `false`) when no recipe is published, recipe steps, examples, and source notes stay in `slothhub stack <slug>` detail, and canonical stack URLs are unchanged.

## 0.1.0

- Add `slothhub completion <shell>` to print a static completion script for bash, zsh, fish, or PowerShell (`pwsh`): commands, subcommands, and flags (including camelCase aliases and closed enum values) are generated from one shared command/flag table that now also drives argument parsing and `--help`, completion never touches the network or writes shell startup files, and an unknown shell fails with a usage error and exit code `2`.
- Accept 2.x search-index feeds that omit the deprecated `search.tokens` and `search.fields` projections; `search.text` remains the only required haystack and feeds that still emit the projections keep working unchanged.
- Add `slothhub handoff <slug|key>` to print the reviewed public agent handoff prompt composed by the shared domain builder — the same prompt family Tool pages offer for copy-and-paste into an agent or provider — plus the canonical Tool page URL and Markdown URL; `--json` returns `prompt`, `detailUrl`, optional `markdownUrl`, `starterPrompts`, and a `providerPolicy` summary, aliases and namespaced keys resolve through the existing lookup, an oversized prompt fails non-zero with `prompt_too_large` plus observed/configured bytes and manual-copy recovery, and tracked `/go/` URLs, install commands, and private fields are never printed.
- List every advertised catalog feed and snapshot in `slothhub doctor` (alias: `feeds`) instead of a hardcoded subset, with `ok` / `unavailable` / `error` status and the same statuses in `--json`.
- Separate citation and tracked Visit output: `cite` now emits only canonical detail and official source URLs, while `open` prints one exact, validated `/go/{slug}?surface=agent` URL without launching a browser.
- Include Product limits and Runtime requirements axes in `slothhub compare` output: each Tool shows a compact `{state, groups|requirements}` projection (metric, scopes, fact state, ambiguous flag — no evidence URLs or notes) and Tools without public facts report `state: "unknown"` rather than implying unlimited capacity; both criteria appear only when at least one compared Tool publishes them.
- Print public Source References (title, source type, URL, checked date) in `slothhub tool` human output under "Source references"; tracked `/go/` URLs are never printed, missing or empty collections omit the section, the rendered list is bounded at the domain's `MAX_PUBLIC_SOURCE_REFERENCES` with a JSON pointer for any remainder, and `--json` output is unchanged.
- Add list mode to `slothhub stack` and `slothhub best`: omitting the slug prints a paginated summary (name, slug, canonical URL, and item count) with `--limit`/`--offset` support and `{total,count,offset,hasMore,nextOffset?,stacks|best}` under `--json`; pagination flags and malformed slugs fail before fetching with recovery text pointing at list mode, and not-found errors name the list command.
- Print the Tool's canonical resource identity (kind, canonical URL, registry ID), taxonomy (categories, tags, use cases), freshness (verified and last-checked timestamps plus destination health), and public resource links in `slothhub tool` human output; tracked `/go/` URLs are filtered from resource links, empty collections say "none listed," and `--json` output is unchanged.
- Emit every `--json` failure as a single-line envelope on stdout with `ok: false`
  and a stable error code, keep human diagnostics on stderr, and document the
  exit-code taxonomy: `0` success (including help and version), `1` runtime
  failures, `2` usage and invalid input.
- Exit `2` before loading command modules when the Node.js runtime is older than
  the package `engines` range, and exit cleanly without a stack trace when output
  pipes close early.
- Print public comparison facts (`bestFor`, `notBestFor`, `strengths`, `limitations`, plus `lastReviewedAt`) in `slothhub tool` human output under their own "Comparison facts" heading, distinct from Fit Guidance; empty or missing objects omit the section while `--json` keeps the full facts.
- Report incompatible catalog feed majors with upgrade instructions and structured
  `unsupported_version` diagnostics (exit `1`) before validating feed content.

- Accept the production `https://slothhub.dev` origin and named SlothHub aliases while retaining HTTPS and host restrictions.
- Add `slothhub mcp-servers` so agents can list public MCP server Tools with registry identity and inert install examples from catalog feeds, matching `slothhub_list_mcp_servers`.
- Add `slothhub skills` so agents can list public agent skill Tools with stored identifiers and inert quickstart strings from catalog feeds.
- Add `slothhub alternatives [slug]` for paginated public alternatives discovery and citation-safe detail output, with typed missing-capability and not-found recovery.
- Add `slothhub categories`, `slothhub tags`, and `slothhub use-cases` so agents can list public taxonomy slugs from the static feeds without guessing search filters.
- Add `slothhub inventory` for a bounded, local-only mapping from one explicit npm package manifest to public Tool identities, and preserve known retired identities in exact Tool lookup errors.
- Share deterministic agent search ranking and fail-closed filter validation with the MCP server, with structured JSON errors for reachable limits and unavailable capabilities.
- Add the `assembly` command for deterministic checks across two to five public Tool detail feeds.
- Reuse Tool detail feeds only when their per-route index hash validates across CLI processes.
- Accept Tool feeds at schema `1.2.x` and search-index feeds at schema `2.1.x`.

## 0.0.0

- Prepare the CLI package for its first provenance-enabled npm release.
