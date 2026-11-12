# Security Policy

## Reporting a vulnerability

Please **do not** open a public issue for security vulnerabilities.

Use
[private vulnerability reporting](https://github.com/marcionicolau/ai-desktop-app/security/advisories/new)
(GitHub Security Advisories) to report a vulnerability. You will get an
acknowledgement and a coordinated disclosure timeline.

## Scope

This is a local-first desktop application. Of particular interest:

- The auto-update path (manifest verification, checksum validation,
  download/apply integrity)
- The Bun FFI boundary to llama.cpp (memory safety at the FFI seam)
- Anything that could execute code in the renderer or read model/user files
  outside the app's data directory

Out of scope: vulnerabilities in upstream dependencies with no demonstrated
exploit path in this app — report those upstream instead, or let Dependabot
handle routine updates.

## Supported versions

Only the latest release channel builds receive fixes. Pre-release (`canary`)
builds are best-effort.
