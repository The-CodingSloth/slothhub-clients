# Releasing

`@slothhub/cli` and `slothhub-mcp-server` are published from this repository by
[`.github/workflows/release-npm.yml`](.github/workflows/release-npm.yml):

| Tag | Package | Protected GitHub environment |
| --- | --- | --- |
| `npm-cli-vX.Y.Z` | `@slothhub/cli` | `npm-cli-release` |
| `npm-mcp-vX.Y.Z` | `slothhub-mcp-server` | `npm-mcp-release` |

The workflow never reads an npm token. npm trusted publishing authenticates it
through GitHub OIDC, and only the `publish` job, which waits for the package's
protected environment, can request an OIDC token. CI can only run
`npm stage publish`; the version becomes public when a maintainer approves the
staged version on npm with 2FA. Every published version carries npm provenance
that names this repository, the workflow and the commit.

The jobs that build and hash a package install dependencies with
`--frozen-lockfile --ignore-scripts`; no dependency needs an install script
(esbuild and Vite+ load their platform binaries from optional packages). The
workspace waits three days (`minimumReleaseAge`) before a newly published
dependency version can enter the lockfile.

## Prepare a release

The source of truth is the upstream monorepo. A release starts there: the
package version and its `CHANGELOG.md` entry are changed upstream, then the
monorepo export produces a new tree for this repository (its source commit is
in [`PROVENANCE.json`](PROVENANCE.json)).

1. Commit the exported tree to a branch and open a pull request. CI installs,
   builds, tests and runs the installed-client readiness check;
   `Release npm package / Dry run ...` packs each package, runs
   `npm publish --dry-run`, installs the tarball in an empty project and uploads
   the tarball, the dry-run report and its SHA-256 manifest for seven days.
2. Review and merge the pull request.
3. For `slothhub-mcp-server`, the version in `server.json` (top level and npm
   package entry) must equal `package.json`; the release check enforces it.

## Stage and approve one package

From the merged commit on `main`, create and push one signed or annotated tag:

```sh
git tag -s npm-cli-v0.1.0 -m "Release @slothhub/cli 0.1.0"
git push origin npm-cli-v0.1.0
```

The prepare job rejects private source, requires the tag to point at a commit
already on `main`, rebuilds, tests, packs and install-smokes the exact
candidate without OIDC, and uploads it. The publish job waits at the package's
environment. Before approving the environment, compare the package, version,
tarball name, SHA-256 and file list with the pull-request dry run.

After environment approval, the job downloads the same artifact, rechecks its
digest and identity, checks the repository is still public, and runs one
`npm stage publish --access public --ignore-scripts --provenance --tag latest`.

Then, from your own machine with npm and 2FA: `npm stage list <package>`,
`npm stage view <stage-id>`, optionally `npm stage download <stage-id>` to
compare the tarball, and `npm stage approve <stage-id>` (or the Staged Packages
page on npmjs.com).

## Verify the published version

1. `npm view <package>@<version> version dist --json`: require the exact
   version and `dist.attestations`. No attestation means provenance is missing.
2. In an empty directory, `npm pack <package>@<version> --ignore-scripts --json`
   and compare its SHA-256 with the approved `release-manifest.json`.
3. Install the version in a clean project with `--ignore-scripts` and run
   `npm audit signatures`.
4. Open the provenance link on npmjs.com and check the repository
   (`The-CodingSloth/slothhub-clients`), the workflow (`release-npm.yml`), the
   commit and the run.

Publishing the MCP package does not publish `server.json` to the MCP Registry;
that is a separate step after npm verification.

## When something fails

- **Before approval:** do not approve; fix upstream and export again. Never move
  a release tag; release a new patch version with a new tag.
- **Staging failed with `ENEEDAUTH`:** the trusted publisher's owner, repository,
  workflow file name or environment does not match exactly (all are
  case-sensitive). Fix the npm settings and re-run the unchanged workflow.
- **Staging may have succeeded:** check `npm stage list <package>` before
  retrying; staged versions use up the version number.
- **Wrong stage:** `npm stage reject <stage-id>` and fix forward with a new
  version.
- **Bad release:** npm versions are immutable. Publish a fixed version, move
  `latest` to it, and deprecate the bad one:
  `npm deprecate '<package>@<bad>' 'Do not use: <reason>. Upgrade to <fixed>.'`
- **Credential or workflow compromise:** remove the trusted publisher, lock the
  environments and tag creation, deprecate affected versions and publish clean
  replacements after review.
