# Changelog

All notable changes to CertChain are documented here. The format loosely follows [Keep a Changelog](https://keepachangelog.com/), and the project adheres to semantic versioning.

## [0.1.0] — Sprint 1 (2026-06)

### Added
- `certchain` Anchor program: the `Credential` account, the `issue_credential` instruction, the `CredentialIssued` event, and a `CertChainError` enum with field-length guards.
- Duplicate-block guard via a hash-seeded PDA (`seeds = [b"credential", credential_hash]`) — re-issuing the same hash fails at `init`.
- Verify-by-student support via `getProgramAccounts` + a `memcmp` filter at byte offset 40 (`STUDENT_FIELD_OFFSET`).
- Test suite (`tests/certchain.ts`): issue + fetch all fields, duplicate-revert, list-by-student, the field-length guard reverts, and an exactly-max-length boundary.
- GitHub Actions CI (Agave 3.1.12 + Anchor 0.31.1): `anchor build` + `anchor test` on every push/PR, with `paths-ignore` for docs-only changes.
- CLI helpers: `yarn issue` (issue a credential) and `yarn query verify|student` (read paths).
- MIT `LICENSE`, `CONTRIBUTING.md`, and `SECURITY.md`.
