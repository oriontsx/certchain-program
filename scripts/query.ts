/**
 * CertChain credential query / verify helper (Sprint 2).
 *
 *   Verify ONE credential by its 32-byte SHA-256 hash (hex), the QR path:
 *     npx ts-node scripts/query.ts verify  <credentialHashHex>
 *
 *   List EVERY credential issued to a student wallet (memcmp at offset 40):
 *     npx ts-node scripts/query.ts student <studentPubkey>
 *
 * RPC defaults to devnet; override with RPC_URL. The program IDL is read from
 * target/idl/certchain.json, so run `anchor build` first.
 */
import * as anchor from "@coral-xyz/anchor";
import { Connection, PublicKey, clusterApiUrl } from "@solana/web3.js";
import * as fs from "fs";
import * as path from "path";

const PROGRAM_ID = new PublicKey("4QFVyA8txKQM6rYsiDBJ4QrNurYtouaJq69KCfWXvKgV");
const STUDENT_FIELD_OFFSET = 40; // 8 (discriminator) + 32 (institution)

function loadCoder(): { coder: anchor.BorshAccountsCoder; accountName: string } {
  const idlPath = path.join(__dirname, "..", "target", "idl", "certchain.json");
  if (!fs.existsSync(idlPath)) {
    throw new Error(`IDL not found at ${idlPath} — run \`anchor build\` first.`);
  }
  const idl = JSON.parse(fs.readFileSync(idlPath, "utf8")) as anchor.Idl;
  const accountName = idl.accounts?.[0]?.name ?? "Credential";
  return { coder: new anchor.BorshAccountsCoder(idl), accountName };
}

function rpc(): Connection {
  return new Connection(process.env.RPC_URL || clusterApiUrl("devnet"), "confirmed");
}

function printCredential(pda: PublicKey, c: any): void {
  console.log(`  credential PDA : ${pda.toBase58()}`);
  console.log(`  institution    : ${c.institution.toBase58()}`);
  console.log(`  student        : ${c.student.toBase58()}`);
  console.log(`  student_name   : ${c.studentName}`);
  console.log(`  degree         : ${c.degree}`);
  console.log(`  department     : ${c.department}`);
  console.log(`  year           : ${c.year}`);
  console.log(`  grade          : ${c.grade}`);
  console.log(`  credential_hash: ${Buffer.from(c.credentialHash).toString("hex")}`);
  console.log(`  issued_at      : ${new Date(c.issuedAt.toNumber() * 1000).toISOString()}`);
}

async function verifyByHash(hashHex: string): Promise<void> {
  const hash = Buffer.from(hashHex.replace(/^0x/, ""), "hex");
  if (hash.length !== 32) {
    throw new Error(`hash must be 32 bytes (64 hex chars); got ${hash.length}`);
  }
  const [pda] = PublicKey.findProgramAddressSync([Buffer.from("credential"), hash], PROGRAM_ID);
  const info = await rpc().getAccountInfo(pda);
  if (!info) {
    console.log(`\n✗ NOT VERIFIED — no credential on-chain for hash ${hashHex}`);
    process.exitCode = 1;
    return;
  }
  const { coder, accountName } = loadCoder();
  console.log(`\n✓ VERIFIED — credential found on-chain:`);
  printCredential(pda, coder.decode(accountName, info.data));
}

async function listByStudent(student: string): Promise<void> {
  const studentKey = new PublicKey(student);
  const { coder, accountName } = loadCoder();
  const accounts = await rpc().getProgramAccounts(PROGRAM_ID, {
    filters: [{ memcmp: { offset: STUDENT_FIELD_OFFSET, bytes: studentKey.toBase58() } }],
  });
  console.log(`\nFound ${accounts.length} credential(s) for student ${student}:`);
  for (const { pubkey, account } of accounts) {
    console.log("");
    printCredential(pubkey, coder.decode(accountName, account.data));
  }
}

async function main(): Promise<void> {
  const [cmd, arg] = process.argv.slice(2);
  if (cmd === "verify" && arg) return verifyByHash(arg);
  if (cmd === "student" && arg) return listByStudent(arg);
  console.log(
    [
      "Usage:",
      "  npx ts-node scripts/query.ts verify  <credentialHashHex>   # verify one credential by hash",
      "  npx ts-node scripts/query.ts student <studentPubkey>       # list a student's credentials",
      "",
      "Env: RPC_URL (defaults to devnet).",
    ].join("\n")
  );
  process.exitCode = 1;
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
