# Security policy

## Report a vulnerability

Do not disclose vulnerabilities in an issue, discussion, pull request, or other
repository content.

Email [security@deleusolie.resend.app](mailto:security@deleusolie.resend.app)
with a concise description, the affected package and version, reproduction steps
or a proof of concept, and the potential impact. Remove tokens, personal data
and unrelated secrets from the report. Maintainers may ask for more details
through the same private channel.

For ordinary bugs without a security impact, open an issue.

## Supported versions

Fixes are released as new versions of `@slothhub/cli` and `slothhub-mcp-server`;
npm versions are immutable. Use the latest published version.

## What the clients do

Both clients only read SlothHub's public feeds, except the CLI `feedback`
command and the MCP `slothhub_submit_feedback` tool, which send the feedback you
write. `slothhub implement --run` runs, after confirmation, only allowlisted
package-manager steps that install or run a package the Tool's own record names
([rule](docs/runnable-commands.md)).
