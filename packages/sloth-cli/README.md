# SlothHub CLI

Search SlothHub's curated developer-tool catalog, inspect official sources, and
compare documented tradeoffs from your terminal or agent workflow.

## Install

Requires Node.js 22.22.0 or newer. Public discovery needs no account or token.

```sh
npm install --global @slothhub/cli
slothhub --help
```

Or run it without installing: `npx @slothhub/cli search "postgres hosting"`.

> `@slothhub/cli` is not on npm yet. Until its first release, build it from a
> clone as described in [Develop from source](#develop-from-source).

## Quick start

```sh
slothhub search "postgres hosting"
slothhub search --kind mcp-server
slothhub tool npm_package:zod --json
slothhub recommend --for "open source auth for nextjs"
slothhub compare supabase neon
```

Search accepts natural-language queries. It ranks partial matches by coverage;
inspect the returned facts before treating a result as a fit for every requirement.
Exact identifiers are useful when you already know the package or repository.

## Commands

| Command | Purpose |
| --- | --- |
| `search [query]` | Search Tools and indexed Articles; filter by kind, pricing, platform, or taxonomy. |
| `tool <slug\|key>` | Read Tool details and official sources by slug or `namespace:value`. Add `--summary` for decision facts only. |
| `recommend --for <requirements>` | Rank candidates with reasons and gaps. |
| `compare <tool...>` | Compare documented Tool facts. |
| `alternatives [slug]` | Browse alternative sets or inspect one Tool's alternatives. |
| `setup --host <agent-host> <slug>` | Print a published setup recipe for review; never execute it. |
| `implement <slug> [--host <h>] [--run <steps>] [--yes]` | Print install commands, skills, host setup, environment names and sourced examples; `--run` runs, without a shell and after confirmation, only steps that install or run a package the Tool's own record names through an allowlisted form of npm, npx, pnpm, yarn, bun, bunx, uv, uvx, pip or pipx ([rule](../../docs/runnable-commands.md)). |
| `feedback <kind> <message>` | Send private feedback (wrong fact, missing tool, setup result, problem, suggestion) to the SlothHub team. |
| `component <slug>` | Print a UI component's files, license notice, npm dependencies and install command; never install it. |
| `doctor` | Diagnose advertised feeds and compatibility. |
| `assembly <tool...>` | Check structured evidence for using Tools together. |
| `manifest <action>` | Create, validate, or render Project Tool pin manifests. |
| `receipt <action>` | Validate or render decision receipts. |
| `completion <shell>` | Print a shell completion script. |
| `help [command] [action]` | Show command and action options. |

Use `slothhub <command> --help` for filters and action syntax, and
`slothhub tool --help` for supported identity namespaces.
`--json` emits machine-readable output; failures include a code and recovery.
Exit codes are a stable contract:

| Code | Meaning |
| --- | --- |
| `0` | Success |
| `1` | Other runtime failure (for example an unsupported feed version or a failed `implement --run` step) |
| `2` | Invalid input; fix the arguments |
| `3` | Not found (unknown or retired Tool, alternatives or component) |
| `4` | Confirmation required or declined (`implement --run` without `--yes`) |

`implement --run` refuses a step the allowlist does not cover with
`step_not_runnable` (exit `2`), naming the refused part in `refusal.code` and
`refusal.part`; read the command and run it yourself if you trust it. Without
`--yes`, a non-interactive run returns `confirmation_required` with the exact
argument vectors in `steps[].argv`. Tool and implementation-kit output mark text
from the Tool's owner or submitter as untrusted data
([details](../../docs/untrusted-catalog-content.md)).
| `5` | Temporarily unavailable (network, timeout, rate limit); retry later |

## Configuration

The default feed origin is `https://slothhub.dev`. Override it with
`--base-url <origin>` or `SLOTHHUB_BASE_URL`; the flag takes precedence.
For example: `slothhub doctor --base-url http://localhost:4321`.
Use the site origin, not `/mcp`. Allowed origins are `https://slothhub.dev`, its
`www` and preview subdomains, and `localhost` or `127.0.0.1` for development.
If the site cannot be reached, commands exit with code `5` with a recovery that
names these overrides.
The CLI reads public SlothHub feeds rather than querying Sanity directly.
Run `slothhub doctor --json` to inspect feed health and compatibility.

## Develop from source

From the root of a clone, using the runtime in `.node-version` and the package
manager declared in the root `package.json`:

```sh
pnpm install --frozen-lockfile
pnpm build:domain
pnpm --filter @slothhub/cli build
node packages/sloth-cli/dist/bin/slothhub.js --help
```

To run the examples above against that build, define
`slothhub() { node packages/sloth-cli/dist/bin/slothhub.js "$@"; }` in the same directory.

## More documentation

- [Agent feeds and citation guidance](https://slothhub.dev/agents.md)
- [MCP client](../slothhub-mcp-server/README.md)
- [Change history](CHANGELOG.md)
