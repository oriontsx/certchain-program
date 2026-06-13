# CertChain — end-to-end walkthrough

A complete demo: build the program, issue a credential, then verify it two ways
(by hash and by student wallet). Uses the CLI helpers in `scripts/`. All commands
run from the repo root.

## 0. Prerequisites

- Rust + Solana CLI (Agave) with `cargo-build-sbf`, Anchor `0.31.1` (via AVM), Node 20 + Yarn.
- A funded wallet at `~/.config/solana/id.json` (or set `ANCHOR_WALLET`). For devnet:
  ```bash
  solana config set --url devnet
  solana airdrop 2
  ```
- Install deps + build (generates the IDL the scripts read):
  ```bash
  yarn install
  anchor build
  ```

## 1. (Optional) Precompute the credential hash — offline

The credential's identity is the SHA-256 of its canonical payload. You can compute
it with no RPC, e.g. to log it or build a QR before issuing:

```bash
yarn hash \
  --institution <yourInstitutionPubkey> \
  --student <studentPubkey> \
  --name "Ada Lovelace" \
  --degree "B.Sc. Computer Science" \
  --department "Computer Science" \
  --year 2026 \
  --grade "First Class"
# -> 64-hex string (the PDA seed + verify key)
```

## 2. Issue the credential

The institution wallet signs and pays. The hash is derived from the same fields,
so you don't pass it explicitly:

```bash
yarn issue \
  --student <studentPubkey> \
  --name "Ada Lovelace" \
  --degree "B.Sc. Computer Science" \
  --department "Computer Science" \
  --year 2026 \
  --grade "First Class"
# -> prints the institution, hash, PDA, and the tx signature
```

Re-running the exact same fields **fails** — the hash-seeded PDA already exists
(the duplicate-block guard). Change any field and it becomes a new credential.

## 3. Verify by hash (the QR path)

```bash
yarn query verify <credentialHashHex>
# ✓ VERIFIED — prints institution, student, degree, year, grade, issued_at
```

If no credential exists for that hash you get `✗ NOT VERIFIED` (exit code 1).

## 4. List all credentials for a student

```bash
yarn query student <studentPubkey>
# Found N credential(s) ... (one block per credential)
```

This uses `getProgramAccounts` with a `memcmp` filter at byte offset 40 (the
`student` field), so it returns every credential issued to that wallet by any
institution.

## 5. Machine-readable output (integrations)

Add `--json` to either `query` command for structured output you can pipe into
`jq` or a verifier service:

```bash
yarn query verify <hashHex> --json
# { "verified": true, "credential": { pda, institution, student, ..., issuedAt, issuedAtIso } }

yarn query student <pubkey> --json
# { "student": "...", "count": N, "credentials": [ ... ] }
```

## Notes

- **RPC:** all read/write commands default to devnet; set `RPC_URL` to target a
  local validator (`RPC_URL=http://127.0.0.1:8899`) or mainnet.
- **Immutability:** Sprint 1 has no update/close instruction — a credential is
  permanent once issued.
- **Trust model:** only a SHA-256 hash + key fields are stored on-chain; richer
  metadata lives off-chain in later sprints.
