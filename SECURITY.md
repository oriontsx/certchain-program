# Security Policy

CertChain is a hackathon-stage project (TrustMint · Hack4FUTO 5.0). We still take security seriously — please report vulnerabilities responsibly.

## Reporting a vulnerability

- **Do not** open a public issue for security reports.
- Open a private [GitHub security advisory](https://github.com/oriontsx/certchain-program/security/advisories/new) on this repo, or contact the TrustMint team directly.
- Include the affected component, a description, and reproduction steps (or a failing test) where possible.

## Scope

- **In scope:** the Anchor program (`programs/certchain`) and the helper scripts (`scripts/`).
- **Out of scope:** third-party dependencies (report upstream), and the off-chain frontend (separate repository).

## Design notes

- The program stores only a SHA-256 hash plus key fields on-chain — **no secrets**.
- A credential's address is a pure function of its hash (`seeds = [b"credential", credential_hash]`), so duplicate issuance of the same hash fails at `init` by design.
- Credentials are **immutable** in Sprint 1 — there is no update or close instruction yet.
