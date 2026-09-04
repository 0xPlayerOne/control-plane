# Credential encryption AAD migration

Migration `0030_right_shen` introduces the `aad-v1` credential ciphertext format. The format binds
the row locator, credential revision, key reference, and format version to AES-GCM authentication.
Existing rows are marked `legacy-v0` and are deliberately unreadable by the updated provider.

This is a maintenance migration, not a mixed-version rolling deployment. An old application writes
ciphertext without AAD; allowing it to write after the schema migration would create new legacy rows.

## Procedure

1. Disable credential creation, rotation, and lease use, then drain every application and worker
   instance that can write or decrypt `credential_secrets`.
2. Back up the database and record the active encryption-key reference. If database integrity is in
   doubt, treat every affected credential as compromised and rotate it at the upstream provider.
3. Apply database migration `0030_right_shen` while old writers remain stopped.
4. Deploy only the AAD-capable application version. Do not restore lease traffic yet.
5. Rotate every credential whose stored row is `legacy-v0`. Rotation writes a new `aad-v1` revision;
   revoke and delete the legacy revision after its replacement is verified.
6. Confirm the following query returns zero before restoring traffic:

   ```sql
   SELECT count(*)
   FROM credential_secrets
   WHERE encryption_version <> 'aad-v1';
   ```

7. Re-enable credential and lease operations and monitor `SECRET_LEGACY_FORMAT`, `SECRET_MISSING`,
   and `SECRET_CORRUPTED` failures. Any such failure is fail-closed and requires credential rotation,
   not metadata rewriting or unauthenticated re-encryption.

Rollback must restore the database backup and the prior application together. Do not run an old
application against a database containing `aad-v1` rows.
