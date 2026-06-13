/**
 * CertChain — batch-issue credentials from a JSON array.
 *
 *   # DRY RUN (default) — prints each credential's hash + PDA, sends NOTHING:
 *   yarn batch-issue --from credentials.json --institution <institutionPubkey>
 *
 *   # ACTUALLY ISSUE (institution wallet signs each):
 *   yarn batch-issue --from credentials.json --send
 *
 * <file.json> is a JSON ARRAY of { student, name, degree, department, year, grade }.
 * Dry run is fully offline (no wallet / RPC); pass --institution to get real
 * hashes. --send loads the wallet (ANCHOR_WALLET or ~/.config/solana/id.json),
 * RPC (RPC_URL, default devnet), and the IDL (target/idl/certchain.json), then
 * issues each credential, continuing past individual failures.
 */
import * as anchor from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey, clusterApiUrl } from "@solana/web3.js";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as crypto from "crypto";

const PROGRAM_ID = new PublicKey("4QFVyA8txKQM6rYsiDBJ4QrNurYtouaJq69KCfWXvKgV");
const REQUIRED = ["student", "name", "degree", "department", "year", "grade"];

const arg = (n: string): string | undefined => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const has = (n: string): boolean => process.argv.includes(`--${n}`);

function credentialHash(institution: string, c: any): Buffer {
  const canonical = [institution, c.student, c.name, c.degree, c.department, String(c.year), c.grade].join("|");
  return crypto.createHash("sha256").update(canonical).digest();
}
const pdaFor = (hash: Buffer): PublicKey =>
  PublicKey.findProgramAddressSync([Buffer.from("credential"), hash], PROGRAM_ID)[0];

function usage(): void {
  console.log(
    [
      "Usage:",
      "  yarn batch-issue --from <file.json> --institution <pubkey>   # DRY RUN (no tx)",
      "  yarn batch-issue --from <file.json> --send                   # issue (wallet signs)",
      "",
      "<file.json>: JSON array of { student, name, degree, department, year, grade }.",
      "Wallet: ANCHOR_WALLET or ~/.config/solana/id.json. RPC: RPC_URL (default devnet).",
    ].join("\n")
  );
}

async function main(): Promise<void> {
  const file = arg("from");
  if (!file) {
    usage();
    process.exitCode = 1;
    return;
  }
  const creds = JSON.parse(fs.readFileSync(file, "utf8"));
  if (!Array.isArray(creds)) throw new Error("--from file must be a JSON ARRAY of credentials");
  const send = has("send");

  let institutionPk: string;
  let program: any = null;
  let walletPk: PublicKey | null = null;
  if (send) {
    const wf = process.env.ANCHOR_WALLET || path.join(os.homedir(), ".config", "solana", "id.json");
    const kp = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(wf, "utf8"))));
    const idlPath = path.join(__dirname, "..", "target", "idl", "certchain.json");
    if (!fs.existsSync(idlPath)) throw new Error(`IDL not found at ${idlPath} — run \`anchor build\` first.`);
    const conn = new Connection(process.env.RPC_URL || clusterApiUrl("devnet"), "confirmed");
    const provider = new anchor.AnchorProvider(conn, new anchor.Wallet(kp), { commitment: "confirmed" });
    program = new anchor.Program(JSON.parse(fs.readFileSync(idlPath, "utf8")) as anchor.Idl, provider);
    walletPk = kp.publicKey;
    institutionPk = kp.publicKey.toBase58();
  } else {
    institutionPk = arg("institution") || "<institution-wallet>";
  }

  console.log(`${send ? "ISSUING" : "DRY RUN"} ${creds.length} credential(s) — institution ${institutionPk}\n`);
  let ok = 0;
  let bad = 0;
  for (const [i, c] of creds.entries()) {
    const missing = REQUIRED.filter((k) => c[k] == null);
    if (missing.length) {
      console.log(`  [${i}] SKIP — missing: ${missing.join(", ")}`);
      bad++;
      continue;
    }
    const hash = credentialHash(institutionPk, c);
    const pda = pdaFor(hash);
    if (!send) {
      console.log(`  [${i}] ${c.name} (${c.student}) — hash ${hash.toString("hex").slice(0, 16)}… pda ${pda.toBase58()}`);
      ok++;
      continue;
    }
    try {
      const sig = await (program.methods as any)
        .issueCredential(Array.from(hash), new PublicKey(c.student), c.name, c.degree, c.department, c.year, c.grade)
        .accounts({ credential: pda, institution: walletPk, systemProgram: anchor.web3.SystemProgram.programId })
        .rpc();
      console.log(`  [${i}] ✓ ${c.name} — ${sig}`);
      ok++;
    } catch (e: any) {
      console.log(`  [${i}] ✗ ${c.name} — ${e?.message || e}`);
      bad++;
    }
  }
  console.log(`\n${send ? "issued" : "previewed"}: ${ok} ok, ${bad} failed/skipped`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
