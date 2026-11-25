# Contributing

Thank you for helping. This repository is exported from SlothHub's private
monorepo (see the README), so:

- **Issues** are the best way to report a bug, an install or platform problem,
  or a feature idea. Include the package and version, your Node.js version and
  operating system, the command or MCP call, and the output.
- **Pull requests** are welcome for fixes and small improvements. They are not
  merged here: a maintainer applies an accepted change upstream, and it arrives
  with the next export, credited to you. Keep each pull request to one change
  and run `pnpm build`, `pnpm test` and `pnpm type-check` first.
- **Catalog data** (a wrong fact, a missing Tool) is fixed upstream through
  `slothhub feedback` or the MCP `slothhub_submit_feedback` tool.
- **Security problems** go through [SECURITY.md](SECURITY.md), never an issue.

Workflows from first-time contributors' forks wait for a maintainer's approval
before they run, and no workflow here gives pull requests access to secrets.
