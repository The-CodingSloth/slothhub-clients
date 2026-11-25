# SlothHub clients

This repository is the public source of the two SlothHub clients published to
npm:

| Package | What it is | Source |
| --- | --- | --- |
| [`@slothhub/cli`](https://www.npmjs.com/package/@slothhub/cli) | The `slothhub` command-line client: search the catalog, read Tool details and official sources, compare Tools and print setup or implementation steps from a terminal or an agent workflow. | [`packages/sloth-cli`](packages/sloth-cli) |
| [`slothhub-mcp-server`](https://www.npmjs.com/package/slothhub-mcp-server) | A read-only Model Context Protocol server over stdio for agent hosts such as Claude Code, Cursor or Codex. | [`packages/slothhub-mcp-server`](packages/slothhub-mcp-server) |

Both read SlothHub's public catalog feeds at <https://slothhub.dev> and need no
account or token. [SlothHub](https://slothhub.dev) is a curated directory of
developer tools for developers and their coding agents.

`packages/domain` holds the shared feed schemas and rules both clients bundle
at build time. It is private and is not published.

## How development works

SlothHub is built in a private monorepo, which stays the source of truth. This
repository is exported from it for each release, with the commit it came from
recorded in [`PROVENANCE.json`](PROVENANCE.json); its history is a sequence of
exports rather than individual development commits.

Issues are welcome here: bug reports, wrong output, install or platform
problems, and feature requests for the CLI or MCP server. Pull requests are
welcome too, but they are not merged directly; a maintainer applies an accepted
change upstream and it arrives in the next export, credited to you. Problems
with catalog data (a wrong fact or a missing Tool) are quickest to fix through
`slothhub feedback` or the MCP `slothhub_submit_feedback` tool.

## Build and test

Use the Node.js version in [`.node-version`](.node-version) and the pnpm version
in `package.json` (`corepack enable` installs it).

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm build
pnpm test
pnpm type-check
pnpm test:agent-clients   # packs both clients, installs the tarballs and runs them
```

No dependency needs an install script. `pnpm check:public-tree` runs the same
content check as CI.

## Releases

Releases are published from this repository by
[`.github/workflows/release-npm.yml`](.github/workflows/release-npm.yml) with npm
trusted publishing and provenance, then approved by a maintainer. See
[RELEASING.md](RELEASING.md).

## Security

Report vulnerabilities privately as described in [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE) © 2026 The Coding Sloth
