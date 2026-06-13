use anchor_lang::prelude::*;

declare_id!("4QFVyA8txKQM6rYsiDBJ4QrNurYtouaJq69KCfWXvKgV");

// =============================================================================
// CertChain — on-chain academic credential registry
// Team TrustMint · Hack4FUTO 5.0
// -----------------------------------------------------------------------------
// Design notes for integrators (frontend / verifier):
//
// 1. ISSUE: An institution (signer/payer) calls `issue_credential`. The
//    credential is stored in a PDA seeded by the SHA-256 hash of the credential
//    data: seeds = [b"credential", credential_hash]. Because the address is a
//    pure function of the hash, re-issuing the SAME hash collides on `init`
//    (the account already exists) and the transaction fails. This is exactly
//    the "block duplicate credential" rule — enforced at the protocol level,
//    no extra lookup needed.
//
// 2. VERIFY BY HASH (QR path): the verifier recomputes / reads the hash, derives
//    the PDA with the same seeds, and fetches the account. If it exists and the
//    stored fields match → Verified. The tx that created it is the proof link.
//
// 3. VERIFY BY STUDENT WALLET ("all credentials for a student"): use
//    getProgramAccounts / `program.account.credential.all([...])` with a memcmp
//    filter on the `student` field. The account layout after the 8-byte Anchor
//    discriminator is: institution (32 bytes) then student (32 bytes), so the
//    `student` field lives at offset 8 + 32 = 40. See STUDENT_FIELD_OFFSET.
// =============================================================================

/// Byte offset of the `student` Pubkey inside the `Credential` account, used for
/// `memcmp` filters (8-byte discriminator + 32-byte `institution` Pubkey).
pub const STUDENT_FIELD_OFFSET: usize = 40;

#[program]
pub mod certchain {
    use super::*;

    /// Issue a new academic credential. Fails if a credential with the same
    /// `credential_hash` already exists (duplicate-submission guard via the
    /// hash-seeded PDA).
    #[allow(clippy::too_many_arguments)] // anchor instruction — the credential fields are the args
    pub fn issue_credential(
        ctx: Context<IssueCredential>,
        credential_hash: [u8; 32],
        student: Pubkey,
        student_name: String,
        degree: String,
        department: String,
        year: u16,
        grade: String,
    ) -> Result<()> {
        require!(
            student_name.len() <= Credential::STUDENT_NAME_MAX,
            CertChainError::StudentNameTooLong
        );
        require!(
            degree.len() <= Credential::DEGREE_MAX,
            CertChainError::DegreeTooLong
        );
        require!(
            department.len() <= Credential::DEPARTMENT_MAX,
            CertChainError::DepartmentTooLong
        );
        require!(
            grade.len() <= Credential::GRADE_MAX,
            CertChainError::GradeTooLong
        );

        let issued_at = Clock::get()?.unix_timestamp;
        let credential = &mut ctx.accounts.credential;

        credential.institution = ctx.accounts.institution.key();
        credential.student = student;
        credential.student_name = student_name;
        credential.degree = degree;
        credential.department = department;
        credential.year = year;
        credential.grade = grade;
        credential.credential_hash = credential_hash;
        credential.issued_at = issued_at;
        credential.bump = ctx.bumps.credential;

        emit!(CredentialIssued {
            institution: credential.institution,
            student: credential.student,
            credential_hash,
            issued_at,
        });

        Ok(())
    }
}

#[derive(Accounts)]
#[instruction(credential_hash: [u8; 32])]
pub struct IssueCredential<'info> {
    #[account(
        init,
        payer = institution,
        space = 8 + Credential::INIT_SPACE,
        seeds = [b"credential", credential_hash.as_ref()],
        bump
    )]
    pub credential: Account<'info, Credential>,

    #[account(mut)]
    pub institution: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[account]
#[derive(InitSpace)]
pub struct Credential {
    /// Issuing institution wallet (the signer/payer of `issue_credential`).
    pub institution: Pubkey,
    /// Student wallet the credential belongs to.
    pub student: Pubkey,
    #[max_len(64)]
    pub student_name: String,
    #[max_len(64)]
    pub degree: String,
    #[max_len(64)]
    pub department: String,
    /// Year of graduation.
    pub year: u16,
    #[max_len(32)]
    pub grade: String,
    /// SHA-256 hash of the canonical credential payload (the uniqueness key).
    pub credential_hash: [u8; 32],
    /// Unix timestamp the credential was issued at.
    pub issued_at: i64,
    /// PDA bump.
    pub bump: u8,
}

impl Credential {
    pub const STUDENT_NAME_MAX: usize = 64;
    pub const DEGREE_MAX: usize = 64;
    pub const DEPARTMENT_MAX: usize = 64;
    pub const GRADE_MAX: usize = 32;
}

#[event]
pub struct CredentialIssued {
    pub institution: Pubkey,
    pub student: Pubkey,
    pub credential_hash: [u8; 32],
    pub issued_at: i64,
}

#[error_code]
pub enum CertChainError {
    #[msg("Student name exceeds the maximum allowed length.")]
    StudentNameTooLong,
    #[msg("Degree exceeds the maximum allowed length.")]
    DegreeTooLong,
    #[msg("Department exceeds the maximum allowed length.")]
    DepartmentTooLong,
    #[msg("Grade exceeds the maximum allowed length.")]
    GradeTooLong,
}
