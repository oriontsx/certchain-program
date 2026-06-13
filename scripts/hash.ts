/**
 * CertChain — compute a credential hash offline (no RPC, no IDL needed).
 *
 *   yarn hash --institution <pubkey> --student <pubkey> --name "Ada Lovelace" \
 *             --degree "B.Sc. CS" --department "Computer Science" \
 *             --year 2026 --grade "First Class"
 *
 * Prints the 32-byte SHA-256 hex of the canonical
 * "institution|student|name|degree|department|year|grade" payload — the
 * credential's uniqueness key and PDA seed. Identical to the hashing in
 * scripts/issue.ts, scripts/query.ts, and the tests, so the output is exactly
 * what `query verify <hash>` expects and what `issue` will derive.
 */
import * as crypto from "crypto";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function main(): void {
  const institution = arg("institution");
  const student = arg("student");
  const name = arg("name");
  const degree = arg("degree");
  const department = arg("department");
  const year = arg("year");
  const grade = arg("grade");

  if (!institution || !student || !name || !degree || !department || !year || !grade) {
    console.log(
      [
        "Usage:",
        "  yarn hash --institution <pubkey> --student <pubkey> --name <name> \\",
        "            --degree <degree> --department <dept> --year <year> --grade <grade>",
        "",
        "Prints the credential's 32-byte SHA-256 hash (hex) — its uniqueness key + PDA seed.",
      ].join("\n")
    );
    process.exitCode = 1;
    return;
  }

  const canonical = [institution, student, name, degree, department, year, grade].join("|");
  const hash = crypto.createHash("sha256").update(canonical).digest("hex");
  console.log(hash);
}

main();
