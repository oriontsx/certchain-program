# CertChain — on-chain academic credential registry

[![CI](https://github.com/oriontsx/certchain-program/actions/workflows/ci.yml/badge.svg)](https://github.com/oriontsx/certchain-program/actions/workflows/ci.yml)

**Team TrustMint · Hack4FUTO 5.0**

CertChain is a Solana / Anchor dApp for issuing and verifying academic credentials. An **institution** issues a credential by connecting its Solana wallet, filling a short form (student name, degree, department, year, grade, student wallet), and signing one transaction. The credential's canonical data is hashed (SHA-256) and the hash plus key fields are written **on-chain**; richer metadata lives off-chain (Supabase) in later sprints. A **student** views the credentials tied to their wallet, and a **verifier** confirms a credential by student wallet address or by QR (which resolves to the on-chain record), seeing institution / degree / year / grade, a **Verified** status, and the on-chain transaction link.

This repository is the **Sprint 1 backend (blockchain)** deliverable: the Anchor program (`certchain`), its on-chain data model, the duplicate-block guard, and an on-chain read/write test.

- **Program ID:** `4QFVyA8txKQM6rYsiDBJ4QrNurYtouaJq69KCfWXvKgV`
- **Cluster:** Devnet (`https://api.devnet.solana.com`)
- **Anchor:** 0.31.1 · **anchor-lang:** 0.31.1

---

## On-chain credential model

The `Credential` account (one PDA per credential):

| Field             | Type        | Description                                                        |
| ----------------- | ----------- | ----------------------------------------------------------------- |
| `institution`     | `Pubkey`    | Issuing institution wallet (the signer / payer of the issue tx).  |
| `student`         | `Pubkey`    | Student wallet the credential belongs to.                         |
| `student_name`    | `String`    | Student full name (max 64 bytes).                                 |
| `degree`          | `String`    | Degree / qualification (max 64 bytes).                            |
| `department`      | `String`    | Department / faculty (max 64 bytes).                              |
| `year`            | `u16`       | Year of graduation.                                               |
| `grade`           | `String`    | Grade / class of degree (max 32 bytes).                           |
| `credential_hash` | `[u8; 32]`  | SHA-256 hash of the canonical credential payload — uniqueness key.|
| `issued_at`       | `i64`       | Unix timestamp the credential was issued at (`Clock`).            |
| `bump`            | `u8`        | PDA bump.                                                         |

Account size is computed at compile time via `#[derive(InitSpace)]` + `#[max_len(..)]`, allocated as `space = 8 + Credential::INIT_SPACE`.

### Errors

`issue_credential` validates field lengths before writing and reverts with a typed `CertChainError`:

| Error                | Condition                        |
| -------------------- | -------------------------------- |
| `StudentNameTooLong` | `student_name` exceeds 64 bytes  |
| `DegreeTooLong`      | `degree` exceeds 64 bytes        |
| `DepartmentTooLong`  | `department` exceeds 64 bytes    |
| `GradeTooLong`       | `grade` exceeds 32 bytes         |

(A duplicate-hash submission reverts at `init` instead — see below.)

---

## Why a hash-seeded PDA blocks duplicates

The credential is stored in a **Program Derived Address seeded by the hash**:

```
seeds = [b"credential", credential_hash]
```

Because the account address is a pure function of `credential_hash`, two identical credentials map to the **same** PDA. The `issue_credential` instruction uses Anchor's `init`, which **fails if the account already exists**. So a duplicate submission (same hash) reverts at the protocol level — no extra lookup, no race. This is the required edge case:

> Duplicate credential submission → system detects the existing hash and blocks re-issuance.

On issue, the program also emits a `CredentialIssued` event (`institution`, `student`, `credential_hash`, `issued_at`).

---

## How verification works

**By hash (QR path).** The verifier recomputes or reads the credential hash, derives the PDA with the same seeds, and fetches the account:

```ts
const [pda] = PublicKey.findProgramAddressSync(
  [Buffer.from("credential"), credentialHash], // credentialHash: 32-byte Buffer
  programId
);
const credential = await program.account.credential.fetch(pda);
// exists + fields match → Verified; the creating tx is the proof link.
```

**By student wallet ("all credentials for a student").** Use `getProgramAccounts` / Anchor's `account.credential.all([...])` with a `memcmp` filter on the `student` field. After the 8-byte discriminator the layout is `institution` (32) then `student` (32), so the `student` field is at **offset 40**:

```ts
const STUDENT_FIELD_OFFSET = 40; // 8 (discriminator) + 32 (institution)

const credentials = await program.account.credential.all([
  { memcmp: { offset: STUDENT_FIELD_OFFSET, bytes: studentPubkey.toBase58() } },
]);
```

The same constant is exported from the program as `pub const STUDENT_FIELD_OFFSET: usize = 40;`.

### Issue / query / verify from the CLI

`scripts/issue.ts` and `scripts/query.ts` wrap the write + read paths as runnable helpers. They read the IDL from `target/idl/certchain.json`, so run `anchor build` first:

```bash
# issue a credential (the institution wallet signs + pays the rent)
yarn issue --student <pubkey> --name "Ada Lovelace" --degree "B.Sc. CS" \
           --department "Computer Science" --year 2026 --grade "First Class"

# verify ONE credential by its 32-byte SHA-256 hash (hex) — the QR path
yarn query verify  <credentialHashHex>

# list EVERY credential issued to a student wallet (memcmp at offset 40)
yarn query student <studentPubkey>
```

RPC defaults to devnet; set `RPC_URL` to target another cluster (e.g. `RPC_URL=http://127.0.0.1:8899` for a local validator).

---

## Build / deploy / test

Prerequisites: Rust + Cargo, the Solana CLI (Agave), and `cargo-build-sbf` (Solana platform-tools). Node + Yarn for the TS tests.

```bash
# 1. Point the Solana CLI at devnet (already the default in this workspace)
solana config set --url devnet

# 2. Install JS deps (test imports)
yarn install

# 3. Build + deploy + test with the Anchor CLI
anchor build
anchor deploy          # deploys to the cluster in Anchor.toml (devnet)
anchor test            # runs tests/certchain.ts against the program
```

### Building without the Anchor CLI

The Anchor **CLI** is not required to *compile* the program. The on-chain program is verified to build with the Solana SBF toolchain directly:

```bash
# from the repo root (or programs/certchain)
cargo build-sbf
```

This produces the deployable `target/deploy/certchain.so`. (On this hackathon's dev box the Anchor CLI / AVM was not installed — the official Anchor NPM binary is x86_64-Linux only — so `cargo build-sbf` is the canonical build check here. `anchor build` / `anchor test` run unchanged on Linux/CI.)

---

## Sprint scope

**Sprint 1 (this deliverable) — DONE**

- Devnet configuration + program keypair / program ID.
- `certchain` Anchor program: `Credential` account, `issue_credential` instruction, `CredentialIssued` event, custom error enum.
- Duplicate-block guard via hash-seeded PDA + `init`.
- On-chain **write** (issue) and **read** (fetch by PDA, list by `student` via memcmp) test, plus the duplicate-revert assertion.
- `scripts/query.ts` CLI helper — verify a credential by hash, list a student's credentials.

**Sprint 2 — deferred**

- Institution minting UI + full frontend wallet integration.
- QR generation (issue) and QR scan → on-chain resolve (verify).
- Off-chain rich metadata in Supabase.
- Student / verifier dashboards wired to the program.

---

## License

MIT
