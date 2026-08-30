import { createHash, randomUUID } from 'node:crypto'
import { chmod, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, resolve, sep } from 'node:path'
import type {
  ObjectStore,
  PutObjectInput,
  StoredObject,
  StoredObjectDescriptor,
} from '@control-plane/deployment'
import { ObjectStoreError } from './index.js'

const METADATA_SUFFIX = '.control-plane.json'

interface FilesystemObjectMetadata {
  readonly schemaVersion: 1
  readonly key: string
  readonly size: number
  readonly contentType?: string
  readonly sha256: `sha256:${string}`
  readonly metadata: Readonly<Record<string, string>>
}

export interface FilesystemObjectStoreOptions {
  readonly rootDirectory: string
  readonly maxObjectBytes: number
}

export class FilesystemObjectStore implements ObjectStore {
  readonly #root: string
  readonly #maxObjectBytes: number
  #closed = false

  constructor(options: FilesystemObjectStoreOptions) {
    if (options.rootDirectory.length === 0 || !Number.isSafeInteger(options.maxObjectBytes)) {
      invalidInput()
    }
    if (options.maxObjectBytes <= 0) invalidInput()
    this.#root = resolve(options.rootDirectory)
    this.#maxObjectBytes = options.maxObjectBytes
  }

  async put(input: PutObjectInput): Promise<StoredObjectDescriptor> {
    this.#assertOpen()
    const paths = this.#paths(input.key)
    if (!(input.body instanceof Uint8Array)) invalidInput()
    if (input.body.byteLength > this.#maxObjectBytes) tooLarge()
    const metadata = validMetadata(input.metadata ?? {})
    const contentType = validContentType(input.contentType)
    const descriptor: FilesystemObjectMetadata = {
      schemaVersion: 1,
      key: input.key,
      size: input.body.byteLength,
      ...(contentType === undefined ? {} : { contentType }),
      sha256: digest(input.body),
      metadata,
    }
    await mkdir(dirname(paths.body), { recursive: true, mode: 0o700 })
    await chmod(dirname(paths.body), 0o700)
    const nonce = randomUUID()
    const bodyTemporary = `${paths.body}.${nonce}.tmp`
    const metadataTemporary = `${paths.metadata}.${nonce}.tmp`
    try {
      await writeFile(bodyTemporary, input.body, { flag: 'wx', mode: 0o600 })
      await writeFile(metadataTemporary, JSON.stringify(descriptor), { flag: 'wx', mode: 0o600 })
      await rename(bodyTemporary, paths.body)
      await rename(metadataTemporary, paths.metadata)
      await chmod(paths.body, 0o600)
      await chmod(paths.metadata, 0o600)
      return publicDescriptor(descriptor)
    } catch (error) {
      await rm(bodyTemporary, { force: true }).catch(() => undefined)
      await rm(metadataTemporary, { force: true }).catch(() => undefined)
      if (error instanceof ObjectStoreError) throw error
      throw providerFailure()
    }
  }

  async get(key: string): Promise<StoredObject> {
    const descriptor = await this.#readDescriptor(key)
    const paths = this.#paths(key)
    try {
      const body = new Uint8Array(await readFile(paths.body))
      if (body.byteLength !== descriptor.size || digest(body) !== descriptor.sha256) {
        integrityFailure()
      }
      return { ...descriptor, body }
    } catch (error) {
      if (error instanceof ObjectStoreError) throw error
      throw notFound()
    }
  }

  head(key: string): Promise<StoredObjectDescriptor> {
    return this.#readDescriptor(key)
  }

  async delete(key: string): Promise<void> {
    this.#assertOpen()
    const paths = this.#paths(key)
    await Promise.all([rm(paths.body, { force: true }), rm(paths.metadata, { force: true })]).catch(
      () => {
        throw providerFailure()
      }
    )
  }

  close(): void {
    this.#closed = true
  }

  async #readDescriptor(key: string): Promise<StoredObjectDescriptor> {
    this.#assertOpen()
    const paths = this.#paths(key)
    try {
      const metadata = JSON.parse(await readFile(paths.metadata, 'utf8')) as unknown
      const descriptor = parseMetadata(metadata, key, this.#maxObjectBytes)
      const bodyStat = await stat(paths.body)
      if (!bodyStat.isFile() || bodyStat.size !== descriptor.size) integrityFailure()
      return publicDescriptor(descriptor)
    } catch (error) {
      if (error instanceof ObjectStoreError) throw error
      throw notFound()
    }
  }

  #paths(key: string): { readonly body: string; readonly metadata: string } {
    const validKey = validateKey(key)
    const body = resolve(this.#root, ...validKey.split('/'))
    if (body !== this.#root && !body.startsWith(`${this.#root}${sep}`)) invalidInput()
    return { body, metadata: `${body}${METADATA_SUFFIX}` }
  }

  #assertOpen(): void {
    if (this.#closed) throw providerFailure()
  }
}

function parseMetadata(
  input: unknown,
  expectedKey: string,
  maxObjectBytes: number
): FilesystemObjectMetadata {
  if (typeof input !== 'object' || input === null) integrityFailure()
  const value = input as Readonly<Record<string, unknown>>
  if (
    value['schemaVersion'] !== 1 ||
    value['key'] !== expectedKey ||
    !Number.isSafeInteger(value['size']) ||
    (value['size'] as number) < 0 ||
    (value['size'] as number) > maxObjectBytes ||
    typeof value['sha256'] !== 'string' ||
    !/^sha256:[a-f0-9]{64}$/.test(value['sha256'])
  ) {
    integrityFailure()
  }
  const contentType = validContentType(value['contentType'])
  return {
    schemaVersion: 1,
    key: expectedKey,
    size: value['size'] as number,
    ...(contentType === undefined ? {} : { contentType }),
    sha256: value['sha256'] as `sha256:${string}`,
    metadata: validMetadata(value['metadata']),
  }
}

function publicDescriptor(metadata: FilesystemObjectMetadata): StoredObjectDescriptor {
  return {
    key: metadata.key,
    size: metadata.size,
    ...(metadata.contentType === undefined ? {} : { contentType: metadata.contentType }),
    sha256: metadata.sha256,
    metadata: { ...metadata.metadata },
  }
}

function validateKey(key: string): string {
  if (
    key.length === 0 ||
    Buffer.byteLength(key) > 1_024 ||
    key.includes('\\') ||
    key.split('/').some((part) => part.length === 0 || part === '.' || part === '..') ||
    Array.from(key).some((character) => character.charCodeAt(0) < 32)
  ) {
    invalidInput()
  }
  return key
}

function validContentType(input: unknown): string | undefined {
  if (input === undefined) return undefined
  if (typeof input !== 'string' || input.length === 0 || Buffer.byteLength(input) > 255) {
    invalidInput()
  }
  return input
}

function validMetadata(input: unknown): Readonly<Record<string, string>> {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) invalidInput()
  const entries = Object.entries(input as Readonly<Record<string, unknown>>)
  if (entries.length > 16) invalidInput()
  const result: Record<string, string> = {}
  let bytes = 0
  for (const [key, value] of entries) {
    if (!/^[a-z0-9][a-z0-9._-]{0,63}$/.test(key) || typeof value !== 'string') invalidInput()
    bytes += Buffer.byteLength(key) + Buffer.byteLength(value)
    if (bytes > 8_192) invalidInput()
    result[key] = value
  }
  return result
}

function digest(body: Uint8Array): `sha256:${string}` {
  return `sha256:${createHash('sha256').update(body).digest('hex')}`
}

function invalidInput(): never {
  throw new ObjectStoreError('OBJECT_STORE_INVALID_INPUT', false)
}

function tooLarge(): never {
  throw new ObjectStoreError('OBJECT_STORE_TOO_LARGE', false)
}

function notFound(): never {
  throw new ObjectStoreError('OBJECT_STORE_NOT_FOUND', false)
}

function integrityFailure(): never {
  throw new ObjectStoreError('OBJECT_STORE_INTEGRITY_FAILURE', false)
}

function providerFailure(): ObjectStoreError {
  return new ObjectStoreError('OBJECT_STORE_PROVIDER_FAILURE', true)
}
