import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PublicKey, Keypair } from "@solana/web3.js";
import * as crypto from "crypto";
import { assert, expect } from "chai";

// The generated IDL types may not exist until `anchor build` runs. We type the
// program loosely so the test compiles either way; switch to
// `Program<Certchain>` (import from ../target/types/certchain) once built.
type Certchain = anchor.Idl;

const STUDENT_FIELD_OFFSET = 40; // 8 (discriminator) + 32 (institution)

/** Canonical credential payload → 32-byte SHA-256 hash (the uniqueness key). */
function hashCredential(fields: {
  institution: string;
  student: string;
  studentName: string;
  degree: string;
  department: string;
  year: number;
  grade: string;
}): Buffer {
  const canonical = [
    fields.institution,
    fields.student,
    fields.studentName,
    fields.degree,
    fields.department,
    String(fields.year),
    fields.grade,
  ].join("|");
  return crypto.createHash("sha256").update(canonical).digest();
}

describe("certchain", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.certchain as Program<Certchain>;
  // `program.account.credential` is fully typed once `anchor build` generates
  // target/types/certchain.ts. Until then we read it through this alias so the
  // test compiles on a box without the Anchor CLI; runtime behavior is identical.
  const credentialAccount = (program.account as any).credential;
  const institution = provider.wallet; // the issuing institution = the signer/payer

  // A fresh student wallet for this run so the test is repeatable.
  const student = Keypair.generate().publicKey;

  const sample = {
    studentName: "Ada Lovelace",
    degree: "B.Sc. Computer Science",
    department: "Computer Science",
    year: 2026,
    grade: "First Class",
  };

  const credentialHash = hashCredential({
    institution: institution.publicKey.toBase58(),
    student: student.toBase58(),
    ...sample,
  });

  const [credentialPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("credential"), credentialHash],
    program.programId
  );

  it("issues a credential and stores all fields on-chain", async () => {
    await program.methods
      .issueCredential(
        Array.from(credentialHash),
        student,
        sample.studentName,
        sample.degree,
        sample.department,
        sample.year,
        sample.grade
      )
      .accounts({
        credential: credentialPda,
        institution: institution.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();

    const acct = await credentialAccount.fetch(credentialPda);

    assert.strictEqual(acct.studentName, sample.studentName);
    assert.strictEqual(acct.degree, sample.degree);
    assert.strictEqual(acct.department, sample.department);
    assert.strictEqual(acct.year, sample.year);
    assert.strictEqual(acct.grade, sample.grade);
    assert.isTrue(
      acct.institution.equals(institution.publicKey),
      "institution must equal the signer"
    );
    assert.isTrue(acct.student.equals(student), "student must match");
    assert.deepStrictEqual(
      Buffer.from(acct.credentialHash),
      credentialHash,
      "credential_hash bytes must match"
    );
    assert.isAbove(acct.issuedAt.toNumber(), 0, "issued_at must be set");
  });

  it("blocks a duplicate credential (same hash) from being re-issued", async () => {
    let threw = false;
    try {
      await program.methods
        .issueCredential(
          Array.from(credentialHash),
          student,
          sample.studentName,
          sample.degree,
          sample.department,
          sample.year,
          sample.grade
        )
        .accounts({
          credential: credentialPda,
          institution: institution.publicKey,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .rpc();
    } catch (err) {
      threw = true; // expected: the hash-seeded PDA already exists → init fails
    }
    if (!threw) {
      assert.fail("Duplicate issuance with the same hash should have reverted");
    }
  });

  it("finds all credentials for a student wallet via memcmp (offset 40)", async () => {
    const found = await credentialAccount.all([
      {
        memcmp: {
          offset: STUDENT_FIELD_OFFSET,
          bytes: student.toBase58(),
        },
      },
    ]);

    expect(found.length).to.be.greaterThanOrEqual(1);
    assert.isTrue(
      found[0].account.student.equals(student),
      "returned account's student must match the filter"
    );
  });

  it("rejects an over-long student_name with StudentNameTooLong", async () => {
    const longName = "x".repeat(65); // on-chain max is 64
    const student2 = Keypair.generate().publicKey;
    const hash2 = hashCredential({
      institution: institution.publicKey.toBase58(),
      student: student2.toBase58(),
      ...sample,
      studentName: longName,
    });
    const [pda2] = PublicKey.findProgramAddressSync(
      [Buffer.from("credential"), hash2],
      program.programId
    );

    let threw = false;
    try {
      await program.methods
        .issueCredential(
          Array.from(hash2),
          student2,
          longName,
          sample.degree,
          sample.department,
          sample.year,
          sample.grade
        )
        .accounts({
          credential: pda2,
          institution: institution.publicKey,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .rpc();
    } catch (err) {
      threw = true; // expected: require!(student_name.len() <= 64) reverts
    }
    assert.isTrue(threw, "over-long student_name should have reverted");
  });

  it("lists multiple credentials for the same student", async () => {
    // Issue a SECOND credential (different degree => different hash/PDA) for the
    // same student, then confirm the memcmp query returns both.
    const degree2 = "M.Sc. Computer Science";
    const hash2 = hashCredential({
      institution: institution.publicKey.toBase58(),
      student: student.toBase58(),
      ...sample,
      degree: degree2,
    });
    const [pda2] = PublicKey.findProgramAddressSync(
      [Buffer.from("credential"), hash2],
      program.programId
    );

    await program.methods
      .issueCredential(
        Array.from(hash2),
        student,
        sample.studentName,
        degree2,
        sample.department,
        sample.year,
        sample.grade
      )
      .accounts({
        credential: pda2,
        institution: institution.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();

    const found = await credentialAccount.all([
      { memcmp: { offset: STUDENT_FIELD_OFFSET, bytes: student.toBase58() } },
    ]);
    expect(found.length).to.be.greaterThanOrEqual(2);
  });

  it("rejects over-long degree, department, and grade", async () => {
    const cases: Array<[string, Partial<typeof sample>]> = [
      ["degree", { degree: "x".repeat(65) }],
      ["department", { department: "x".repeat(65) }],
      ["grade", { grade: "x".repeat(33) }], // grade max is 32
    ];
    for (const [label, override] of cases) {
      const student2 = Keypair.generate().publicKey;
      const fields = { ...sample, ...override };
      const hash2 = hashCredential({
        institution: institution.publicKey.toBase58(),
        student: student2.toBase58(),
        ...fields,
      });
      const [pda2] = PublicKey.findProgramAddressSync(
        [Buffer.from("credential"), hash2],
        program.programId
      );
      let threw = false;
      try {
        await program.methods
          .issueCredential(
            Array.from(hash2),
            student2,
            fields.studentName,
            fields.degree,
            fields.department,
            fields.year,
            fields.grade
          )
          .accounts({
            credential: pda2,
            institution: institution.publicKey,
            systemProgram: anchor.web3.SystemProgram.programId,
          })
          .rpc();
      } catch (err) {
        threw = true;
      }
      assert.isTrue(threw, `over-long ${label} should have reverted`);
    }
  });

  it("accepts exactly-max-length fields and stores the bump", async () => {
    const student2 = Keypair.generate().publicKey;
    const fields = {
      studentName: "n".repeat(64),
      degree: "d".repeat(64),
      department: "p".repeat(64),
      year: 2026,
      grade: "g".repeat(32),
    };
    const hash2 = hashCredential({
      institution: institution.publicKey.toBase58(),
      student: student2.toBase58(),
      ...fields,
    });
    const [pda2] = PublicKey.findProgramAddressSync(
      [Buffer.from("credential"), hash2],
      program.programId
    );

    await program.methods
      .issueCredential(
        Array.from(hash2),
        student2,
        fields.studentName,
        fields.degree,
        fields.department,
        fields.year,
        fields.grade
      )
      .accounts({
        credential: pda2,
        institution: institution.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();

    const acct = await credentialAccount.fetch(pda2);
    assert.lengthOf(acct.studentName, 64);
    assert.lengthOf(acct.degree, 64);
    assert.lengthOf(acct.grade, 32);
    assert.isNumber(acct.bump);
  });

  it("returns no credentials for a student that has none", async () => {
    const stranger = Keypair.generate().publicKey;
    const found = await credentialAccount.all([
      { memcmp: { offset: STUDENT_FIELD_OFFSET, bytes: stranger.toBase58() } },
    ]);
    expect(found.length).to.equal(0);
  });

  it("round-trips u16 year bounds and empty optional fields", async () => {
    const cases: Array<[string, any]> = [
      ["max year + empty strings", { studentName: "", degree: "", department: "", year: 65535, grade: "" }],
      ["zero year", { studentName: "Zed", degree: "PhD", department: "Maths", year: 0, grade: "Pass" }],
    ];
    for (const [label, fields] of cases) {
      const student2 = Keypair.generate().publicKey;
      const hash2 = hashCredential({
        institution: institution.publicKey.toBase58(),
        student: student2.toBase58(),
        ...fields,
      });
      const [pda2] = PublicKey.findProgramAddressSync(
        [Buffer.from("credential"), hash2],
        program.programId
      );
      await program.methods
        .issueCredential(
          Array.from(hash2),
          student2,
          fields.studentName,
          fields.degree,
          fields.department,
          fields.year,
          fields.grade
        )
        .accounts({
          credential: pda2,
          institution: institution.publicKey,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .rpc();
      const acct = await credentialAccount.fetch(pda2);
      assert.strictEqual(acct.year, fields.year, `${label}: year`);
      assert.strictEqual(acct.studentName, fields.studentName, `${label}: name`);
    }
  });
});
