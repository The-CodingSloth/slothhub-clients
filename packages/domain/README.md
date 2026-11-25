# Shared catalog contracts

Feed schemas, identity, validation and formatting rules shared by the SlothHub
CLI and MCP server. Both packages bundle this code into their published
JavaScript and declarations, so this package is private and never published.

It contains only the modules the two clients (and their tests) import. The
complete package, with its own unit tests, lives in the upstream monorepo.
