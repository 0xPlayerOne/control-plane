import type { EncryptedSecretStore } from '@control-plane/credential-vault'
import { and, eq } from 'drizzle-orm'
import type { ControlPlaneDatabase } from './connection.js'
import { credentialSecrets } from './schema/credential-secrets.js'

export class PostgresEncryptedSecretStore implements EncryptedSecretStore {
  constructor(private readonly database: ControlPlaneDatabase) {}

  async put(input: Parameters<EncryptedSecretStore['put']>[0]): Promise<void> {
    await this.database
      .insert(credentialSecrets)
      .values(input)
      .onConflictDoNothing({ target: [credentialSecrets.locator, credentialSecrets.version] })
  }

  async get(
    input: Parameters<EncryptedSecretStore['get']>[0]
  ): ReturnType<EncryptedSecretStore['get']> {
    const [record] = await this.database
      .select({
        ciphertext: credentialSecrets.ciphertext,
        iv: credentialSecrets.iv,
        authTag: credentialSecrets.authTag,
        keyReference: credentialSecrets.keyReference,
        encryptionVersion: credentialSecrets.encryptionVersion,
      })
      .from(credentialSecrets)
      .where(
        and(
          eq(credentialSecrets.locator, input.locator),
          eq(credentialSecrets.version, input.version)
        )
      )
      .limit(1)
    return record
  }

  async delete(input: Parameters<EncryptedSecretStore['delete']>[0]): Promise<void> {
    await this.database
      .delete(credentialSecrets)
      .where(
        and(
          eq(credentialSecrets.locator, input.locator),
          eq(credentialSecrets.version, input.version)
        )
      )
  }
}
