# Changelog

Notable changes to JobInsight. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
versions follow [Semantic Versioning](https://semver.org/).

Entries from v0.1.0 onward are generated from Conventional Commits by
`scripts/build-release-notes.sh`.

## [Unreleased]

Nothing yet.

## [0.1.0] — 2026-09-15

First tagged release. The extension version in `manifest.json` and the tag now
agree, so "which build is this" has an answer.

### Added

- Chrome MV3 extension that analyses LinkedIn job postings in place: experience,
  education, sponsorship, US citizenship or clearance, a short summary, and
  highlighted keywords
- Draggable, resizable overlay; results cached for seven days
- Backend proxy holding the OpenAI key behind Google OAuth, so the key never
  ships in extension source
- `/api/health`, advertised by the root document

### Infrastructure

- CI on Node 20 and 22 covering the proxy's origin allowlist: requests with no
  Origin, from another extension id, and from an ordinary web page are refused;
  the configured extension is not; an oversized body returns 413 rather than
  being proxied
- `scripts/validate-manifest.mjs` checks the manifest parses, declares MV3, and
  that every file it references exists — a manifest naming a renamed file loads
  as a broken extension and nothing else catches it
- `npm audit` at high severity, and a syntax check over every extension script
- Conventional commits enforced; releases generated from them

[Unreleased]: https://github.com/bibeshpyakurel/JobInsight/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/bibeshpyakurel/JobInsight/releases/tag/v0.1.0
