/**
 * CertChain — issue a credential from the CLI (the institution signs locally).
 *
 *   yarn issue \
 *     --student <studentPubkey> \
 *     --name "Ada Lovelace" \
 *     --degree "B.Sc. Computer Science" \
 *     --department "Computer Science" \
 *     --year 2026 \
 *     --grade "First Class"
 *
 * Wallet: ANCHOR_WALLET or ~/.config/solana/id.json (the issuing institution +
 * fee payer). RPC: RPC_URL (defaults to devnet). IDL: target/idl/certchain.json
 * (run `anchor build` first). The credential hash is the SHA-256 of the same
 * canonical "institution|student|name|degree|department|year|grade" payload the
 * program/tests use, so it matches what `scripts/query.ts verify` expects.
 */
import * as anchor from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey, clusterApiUrl } from "@solana/web3.js";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as crypto from "crypto";

const PROGRAM_ID = new PublicKey("4QFVyA8txKQM6rYsiDBJ4QrNurYtouaJq69KCfWXvKgV");

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function loadKeypair(): Keypair {
  const file =
    process.env.ANCHOR_WALLET ||
    path.join(os.homedir(), ".config", "solana", "id.json");
  const secret = JSON.parse(fs.readFileSync(file, "utf8")) as number[];
  return Keypair.fromSecretKey(Uint8Array.from(secret));
}

function loadIdl(): anchor.Idl {
  const idlPath = path.join(__dirname, "..", "target", "idl", "certchain.json");
  if (!fs.existsSync(idlPath)) {
    throw new Error(`IDL not found at ${idlPath} — run \`anchor build\` first.`);
  }
  return JSON.parse(fs.readFileSync(idlPath, "utf8")) as anchor.Idl;
}

function hashCredential(f: {
  institution: string;
  student: string;
  studentName: string;
  degree: string;
  department: string;
  year: number;
  grade: string;
}): Buffer {
  const canonical = [
    f.institution,
    f.student,
    f.studentName,
    f.degree,
    f.department,
    String(f.year),
    f.grade,
  ].join("|");
  return crypto.createHash("sha256").update(canonical).digest();
}

async function main(): Promise<void> {
  const studentStr = arg("student");
  const studentName = arg("name");
  const degree = arg("degree");
  const department = arg("department");
  const yearStr = arg("year");
  const grade = arg("grade");

  if (!studentStr || !studentName || !degree || !department || !yearStr || !grade) {
    console.log(
      [
        "Usage:",
        "  yarn issue --student <pubkey> --name <name> --degree <degree> \\",
        "             --department <dept> --year <year> --grade <grade>",
        "",
        "Wallet: ANCHOR_WALLET or ~/.config/solana/id.json. RPC: RPC_URL (default devnet).",
      ].join("\n")
    );
    process.exitCode = 1;
    return;
  }

  const student = new PublicKey(studentStr);
  const year = parseInt(yearStr, 10);
  if (!Number.isInteger(year)) throw new Error(`--year must be an integer; got ${yearStr}`);

  const keypair = loadKeypair();
  const connection = new Connection(process.env.RPC_URL || clusterApiUrl("devnet"), "confirmed");
  const provider = new anchor.AnchorProvider(connection, new anchor.Wallet(keypair), {
    commitment: "confirmed",
  });
  const program = new anchor.Program(loadIdl(), provider);

  const credentialHash = hashCredential({
    institution: keypair.publicKey.toBase58(),
    student: student.toBase58(),
    studentName,
    degree,
    department,
    year,
    grade,
  });
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("credential"), credentialHash],
    PROGRAM_ID
  );

  console.log(`Issuing credential for ${studentName} (${student.toBase58()})`);
  console.log(`  institution : ${keypair.publicKey.toBase58()}`);
  console.log(`  hash        : ${credentialHash.toString("hex")}`);
  console.log(`  PDA         : ${pda.toBase58()}`);

  const sig = await (program.methods as any)
    .issueCredential(Array.from(credentialHash), student, studentName, degree, department, year, grade)
    .accounts({
      credential: pda,
      institution: keypair.publicKey,
      systemProgram: anchor.web3.SystemProgram.programId,
    })
    .rpc();

  console.log(`\n✓ Issued. tx: ${sig}`);
  console.log(`  verify with: yarn query verify ${credentialHash.toString("hex")}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
