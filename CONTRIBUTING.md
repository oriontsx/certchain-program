# Contributing to CertChain

CertChain is the on-chain credential registry for **TrustMint** (Hack4FUTO 5.0). Contributions are welcome.

## Prerequisites

- Rust + Cargo and the Solana CLI (Agave) with `cargo-build-sbf` (Solana platform tools)
- Anchor `0.31.1` (via [AVM](https://www.anchor-lang.com/docs/installation))
- Node 20 + Yarn (for the TypeScript tests + scripts)

## Build & test

```bash
yarn install
anchor build               # builds the program + generates the IDL/types
anchor test                # runs tests/certchain.ts against a local validator
```

To compile the program **without** the Anchor CLI (the official Anchor binary is Linux-only):

```bash
cargo build-sbf            # produces target/deploy/certchain.so
```

CI (`.github/workflows/ci.yml`) runs `anchor build` + `anchor test` on every push and pull request.

## Conventions

- Keep changes **surgical** — match the existing style, don't refactor unrelated code.
- Add or update a **test** for any new program behavior.
- Run `yarn lint` (Prettier) on TypeScript before opening a PR.
- Use conventional-style commit prefixes: `feat:`, `fix:`, `test:`, `docs:`, `ci:`, `chore:`.

## Helper scripts

- `yarn issue --student <pubkey> --name ... --degree ... --department ... --year ... --grade ...` — issue a credential
- `yarn query verify <hashHex>` — verify a credential by its hash
- `yarn query student <pubkey>` — list a student's credentials
