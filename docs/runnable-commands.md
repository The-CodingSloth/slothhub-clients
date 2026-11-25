# Which catalog commands `slothhub implement --run` runs

Install commands in the SlothHub catalog come from tool owners, submitters and,
through auto-fill, from the submitter's own pages. An editor approves them, but
the people and agents who run them often do so without reading them. So
`slothhub implement <slug> --run <steps>` runs a step only when it passes one
rule, `packages/domain/src/runnableCommand.ts`. The same rule marks each
implementation-kit step `run.runnable` for the CLI and the MCP
`slothhub_get_implementation_kit` tool, lists each runnable step's packages with
what names them (`basis`) and whether their link back to the Tool is verified
(`link`), and upstream it blocks publication of a command that fails it and
warns about one it only shows.

A command that is refused is still shown, with the reason, for a person to read
and run by hand.

## The allowlist

A command runs only if it has no shell syntax, only printable ASCII, and matches
one of these forms. `<npm>` is a registry package name with an optional
`@version`, range or tag (`zod`, `@scope/pkg@1.2.3`, `pkg@latest`). `<npm@pin>`
is an npm name with an exact version or a dist-tag (`pkg@1.2.3`, `pkg@latest`),
never a bare name or a range. `<pypi>` is a PyPI project name with an optional
`==version` (`uvx` also accepts `@version`). No URL, `git+`, `github:`, `file:`,
`catalog:`, local path, archive, `npm:` alias or other registry or index is a
package.

| Program | Allowed forms | Allowed flags |
| --- | --- | --- |
| `npm` | `npm install\|i\|add [flags] <npm>...` | `-g` `--global` `-D` `--save-dev` `-E` `--save-exact` `-O` `--save-optional` |
| `npx` | `npx [flags] <npm@pin> [word...]` | `-y` `--yes` |
| `pnpm` | `pnpm add [flags] <npm>...`; `pnpm dlx <npm> [word...]` | add: `-g` `--global` `-D` `--save-dev` `-E` `--save-exact` `-O` `--save-optional` |
| `yarn` | `yarn add [flags] <npm>...`; `yarn global add <npm>...`; `yarn dlx <npm> [word...]` | add: `-D` `--dev` `-E` `--exact` `-O` `--optional` |
| `bun` | `bun add\|install\|i [flags] <npm>...` | `-d` `-D` `--dev` `-g` `--global` `-E` `--exact` `--optional` |
| `bunx` | `bunx <npm@pin> [word...]` | none |
| `uv` | `uv add [flags] <pypi>...`; `uv tool install <pypi>...`; `uv pip install [flags] <pypi>...` | add: `--dev`; pip install: `-U` `--upgrade` |
| `uvx` | `uvx <pypi> [word...]` | none |
| `pip` | `pip install [flags] <pypi>...` | `-U` `--upgrade` `--user` |
| `pipx` | `pipx install <pypi>...` | none |

`[word...]` are arguments for the package's own command, such as `mcp` or
`init`: letters, digits, `.`, `_` and `-`, starting with a letter or digit. Flags,
paths and URLs there are refused.

`npx <name>` without a pin, `npx <name>@<range>`, `bunx <name>` without a pin and
every `pipx run` are shown but not run (`resolution_depends_on_directory`); the
next section says why. The refusal names the form to record instead.

Three helper packages are allowed because SlothHub itself derives commands for
them. Each exception holds only for that npm package, under the exact programs
listed, with `add <target>` and nothing else; under any other program the same
name is a different package (`uvx skills` and `pipx run skills` would fetch an
unrelated PyPI project), so there it gets no exception and is refused like any
package the Tool does not name. Under `npx` and `bunx` the helper needs a pin
like every other package. What binds the step to the Tool is the target, not the
helper:

| Helper (npm) | Programs | The target must be |
| --- | --- | --- |
| `skills` | `npx skills@<pin>`, `pnpm dlx skills`, `yarn dlx skills`, `bunx skills@<pin>` | `owner/repo` or a GitHub skill folder URL whose repository the Tool's record names |
| `jsr` | `npx jsr@<pin>` | a JSR package the Tool's record names |
| `shadcn` | `npx shadcn@<pin>`, `pnpm dlx shadcn` | this Tool's SlothHub component registry item (`<site>/r/<slug>.json`), only for the step SlothHub adds for its own registry |

SlothHub's own derived steps use the pinned form: `npx <pkg>@latest`,
`npx skills@latest add …`, `npx jsr@latest add …` and
`npx shadcn@latest add …`.

## How each program finds a package

Checked on 2026-11-24 against each program's current documentation and, where
the documentation is silent, its source.

| Form | How the name is resolved | `--run` |
| --- | --- | --- |
| `npx <name>`, `npm exec` | Before the registry, a bare name is looked up as a `bin` of the local `package.json`, as `node_modules/.bin/<name>` in the working directory and every parent up to `/`, and in the global bin directory; then any installed copy in the local tree is used, whatever its version. With a specifier, "package names with a specifier will only be considered a match if they have the exact same name and version as the local dependency" ([npm exec](https://docs.npmjs.com/cli/commands/npm-exec), [libnpmexec](https://github.com/npm/cli/blob/latest/workspaces/libnpmexec/lib/index.js)); a range matches any local copy in the range. `--package=<spec> -- <bin>` changes which bin runs, not where the package comes from, and then finds `<bin>` on a `PATH` that includes the project's `node_modules/.bin`. | Only `name@<exact version>` or `name@<dist-tag>`. |
| `pnpm dlx` | "Fetches a package from the registry without installing it as a dependency" into its own cache, and ignores the current directory's pnpmfile, hooks, script shell, overrides and patches ([pnpm dlx](https://pnpm.io/cli/dlx)). `catalog:` versions read the workspace and are refused as a source. | Any `<npm>`. |
| `yarn dlx` | Installs the package into a new temporary project and runs its binary from there ([yarn dlx source](https://github.com/yarnpkg/berry/blob/master/packages/plugin-dlx/sources/commands/dlx.ts)). | Any `<npm>`. |
| `bunx` | "Checks for a locally installed package first, then falls back to auto-installing it from npm. With a version (`bunx my-cli@2`), it does not use the local package" ([bunx](https://bun.com/docs/pm/bunx)). | Only `name@<exact version>` or `name@<dist-tag>` (one rule with `npx`; bunx would also accept a range). |
| `uvx` | Runs the tool in an environment "isolated from the current project"; a bare name uses the version installed with `uv tool install`, or the cached one ([uv tools](https://docs.astral.sh/uv/concepts/tools/)). Neither depends on the working directory. | Any `<pypi>`. |
| `pipx run` | A bare name that is a file in the working directory runs that file as a script, and with the pip backend `__pypackages__/<python>/lib/bin/<app>` in the working directory runs before anything is installed, with or without a version ([pipx run source](https://github.com/pypa/pipx/blob/main/src/pipx/commands/run.py), [running scripts](https://github.com/pypa/pipx/blob/main/docs/how-to/run-scripts.rst)). | Never. Record `pipx install <name>` or `uvx <name>`. |

What none of these rules cover: a directory that someone controls can still
redirect any package manager through its configuration files (`.npmrc`
registry or script shell, `.yarnrc.yml` `yarnPath` or plugins, `bunfig.toml`,
`uv.toml` or `pyproject.toml` indexes). That applies to the install forms too,
and to the same command typed by hand. `--run` runs in the current directory;
run it in a project you trust.

## Package binding

Every package a step installs or runs must be one the Tool's own record names:

- its resource identity: an `npm_package`, `pypi_project` or `jsr_package`
  registry ID, or a `github_repository` (for skills);
- the `identifier` of a current (not deprecated) Agent Interface whose `source` is
  `npm`, `pypi`, `jsr` or `github`;
- the GitHub repository of a current `agent_skill` interface's docs URL.

npm names must match exactly; PyPI names compare after PEP 503 normalization.
There is no prefix or scope matching: `@example/sdk` does not bind
`@example/other`. An identifier without a `source` binds nothing, because without
a source it is unvalidated free text (for example a remote MCP URL).

A step for another package is refused with `package_not_bound`. The catalog
fix is to set the interface's source and identifier to the package when it
really is the Tool's package, or to link the setup docs instead.

### Package links

An Agent Interface row can be proposed by the Tool's owner or filled from the
submitter's page, so a row naming a package is the same party vouching for
itself. A package named only by a row therefore runs only when a registry check
has recorded that the package's own registry metadata (npm `repository` or
`homepage`, PyPI project URLs, a GitHub repository's homepage) links back to
the Tool's repository or site:

- the link must be to the Tool's GitHub repository (its resource identity or a
  GitHub website) or to the exact host of its website or canonical URL, ignoring
  `www.`;
- the check must be at most seven days old and not dated in the future. The
  registry sweep rechecks daily, so this tolerates a week of missed sweeps
  (unmeasured: no links are recorded yet);
- no record, a record for another package, an unreadable date or a link
  anywhere else fails closed as `missing`, `stale` or `mismatch`, and the
  refusal (`package_link_unverified`) says which.

A package the resource identity names needs no link (`link: "not_required"`),
nor does SlothHub's own component item. One switch,
`RUNNABLE_PACKAGE_LINK_POLICY` in the rule, sets `require` (refuse) or `report`
(run and report the state). **It ships as `require`.** The record is
`PackageLinkEvidence` (`registry`, `identifier`, `linkedUrls`, `checkedAt`) on
the interface row; SlothHub's registry check does not record it for npm or PyPI
packages yet, so until it does, a package only an interface row names is shown
and not run.

## Why the rule is this narrow

Measured on 2026-11-24 over the 60 distinct command steps in SlothHub's catalog
fixtures: the previous rule ran 18 of them and the package rule ran 9. The 9 it
refuses are legitimate installs whose catalog record names the package without
saying which registry it comes from (`package_not_bound`); setting that one
field in the catalog makes all 18 pass, so the rule was not widened. No
malicious step was in the fixtures.

A second measurement the same day, over the later fixtures (29 steps the
original rule ran), found that the resolution rule refuses one step, a listing
that records `npx skills add …` without a pin, and that every runnable step is
bound by the Tool's resource identity, so requiring package links stops none of
them. SlothHub's own derived steps carry `@latest` and still run.

## Running steps unattended

`--yes` still runs steps without a prompt, and without `--yes` a
non-interactive run still returns `confirmation_required` (exit 4) with the
exact argument vectors in `steps[].argv`. Steps that pass the allowlist may run
unattended because the allowlist reduces a step to "install or run this Tool's
own package from its public registry", which is what an agent that asked to
implement the Tool has already chosen to do. Everything that changes the
machine beyond that (package-manager configuration, other registries, scripts,
shell strings, other packages, packages found in the working directory) is
refused before any prompt, with or without `--yes`.

A refused step returns `step_not_runnable` (exit 2) with `step`,
`refusal.code`, `refusal.part` and a recovery that says the user can read the
command and run it by hand:

```json
{"ok": false, "code": "step_not_runnable", "step": 3,
 "refusal": {"code": "resolution_depends_on_directory", "part": "example-cli"},
 "message": "Step 3 cannot run automatically: npx example-cli first uses a example-cli it finds in the working directory ...",
 "recovery": "SlothHub only runs a plain install or run of this Tool's own registry package. ..."}
```

Refusal codes: `not_shell`, `shell_syntax`, `unsupported_characters`,
`program_not_allowed`, `form_not_allowed`, `flag_not_allowed`,
`package_missing`, `package_source_not_allowed`, `argument_not_allowed`,
`package_not_bound`, `resolution_depends_on_directory`,
`package_link_unverified`.

## What is shown is what runs

The confirmation prompt and `confirmation_required` show
`program args...` from the parsed step, through the same terminal-safety
function as the rest of the output, and the CLI executes that same parsed
`program` and `args` with `spawn(..., {shell: false})`. The kit is built once
from one feed response; nothing is re-fetched or re-parsed between the prompt
and execution. Tokens are printable ASCII without spaces, so the displayed line
cannot be read two ways. `ran[].argv` reports what ran; `ran[].command` keeps
the catalog text as before. On Windows `--run` still refuses with
`unsupported_platform`.
