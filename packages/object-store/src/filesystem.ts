import { createHash, randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { lstat, mkdir, open, realpath, rename, rm } from 'node:fs/promises'
import { resolve } from 'node:path'
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
  #canonicalRoot: string | undefined
  #rootDevice: number | undefined
  #rootInode: number | undefined
  #closed = false

  constructor(options: FilesystemObjectStoreOptions) {
    if (options.rootDirectory.length === 0 || !Number.isSafeInteger(options.maxObjectBytes)) {
      invalidInput()
    }
    if (options.maxObjectBytes <= 0) invalidInput()
    if (process.platform === 'win32' || constants.O_NOFOLLOW === undefined) {
      throw providerFailure()
    }
    this.#root = resolve(options.rootDirectory)
    this.#maxObjectBytes = options.maxObjectBytes
  }

  async put(input: PutObjectInput): Promise<StoredObjectDescriptor> {
    this.#assertOpen()
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
    const paths = await this.#paths(input.key, true)
    await Promise.all([
      assertRegularFileOrMissing(paths.body),
      assertRegularFileOrMissing(paths.metadata),
    ])
    const nonce = randomUUID()
    const bodyTemporary = `${paths.body}.${nonce}.tmp`
    const metadataTemporary = `${paths.metadata}.${nonce}.tmp`
    try {
      await writeExclusive(bodyTemporary, input.body)
      await writeExclusive(metadataTemporary, JSON.stringify(descriptor))
      await this.#paths(input.key, false)
      await Promise.all([
        assertRegularFileOrMissing(paths.body),
        assertRegularFileOrMissing(paths.metadata),
      ])
      await rename(bodyTemporary, paths.body)
      await this.#paths(input.key, false)
      await assertRegularFileOrMissing(paths.metadata)
      await rename(metadataTemporary, paths.metadata)
      return publicDescriptor(descriptor)
    } catch (error) {
      await rm(bodyTemporary, { force: true }).catch(() => undefined)
      await rm(metadataTemporary, { force: true }).catch(() => undefined)
      if (error instanceof ObjectStoreError) throw error
      throw providerFailure()
    }
  }

  async get(key: string): Promise<StoredObject> {
    return this.#readObject(key, true)
  }

  async head(key: string): Promise<StoredObjectDescriptor> {
    return this.#readObject(key, false)
  }

  async delete(key: string): Promise<void> {
    this.#assertOpen()
    let paths: { readonly body: string; readonly metadata: string }
    try {
      paths = await this.#paths(key, false)
    } catch (error) {
      if (error instanceof ObjectStoreError && error.code === 'OBJECT_STORE_NOT_FOUND') return
      throw error
    }
    await Promise.all([
      assertRegularFileOrMissing(paths.body),
      assertRegularFileOrMissing(paths.metadata),
    ])
    try {
      await this.#paths(key, false)
      await Promise.all([rm(paths.body, { force: true }), rm(paths.metadata, { force: true })])
    } catch (error) {
      if (error instanceof ObjectStoreError) throw error
      throw providerFailure()
    }
  }

  close(): void {
    this.#closed = true
  }

  async #readObject(key: string, includeBody: true): Promise<StoredObject>
  async #readObject(key: string, includeBody: false): Promise<StoredObjectDescriptor>
  async #readObject(
    key: string,
    includeBody: boolean
  ): Promise<StoredObject | StoredObjectDescriptor> {
    this.#assertOpen()
    let metadataHandle: Awaited<ReturnType<typeof open>> | undefined
    let bodyHandle: Awaited<ReturnType<typeof open>> | undefined
    try {
      const paths = await this.#paths(key, false)
      await Promise.all([assertRegularFile(paths.body), assertRegularFile(paths.metadata)])
      metadataHandle = await openNoFollow(paths.metadata)
      bodyHandle = await openNoFollow(paths.body)
      const metadata = JSON.parse(await metadataHandle.readFile('utf8')) as unknown
      const descriptor = parseMetadata(metadata, key, this.#maxObjectBytes)
      const bodyStat = await bodyHandle.stat()
      if (!bodyStat.isFile() || bodyStat.size !== descriptor.size) integrityFailure()
      const publicMetadata = publicDescriptor(descriptor)
      if (!includeBody) return publicMetadata
      const body = new Uint8Array(await bodyHandle.readFile())
      if (body.byteLength !== descriptor.size || digest(body) !== descriptor.sha256) {
        integrityFailure()
      }
      return { ...publicMetadata, body }
    } catch (error) {
      if (error instanceof ObjectStoreError) throw error
      if (isSymlinkLoop(error)) integrityFailure()
      if (isMissing(error)) notFound()
      if (error instanceof SyntaxError) integrityFailure()
      throw providerFailure()
    } finally {
      await bodyHandle?.close().catch(() => undefined)
      await metadataHandle?.close().catch(() => undefined)
    }
  }

  async #paths(
    key: string,
    createRoot: boolean
  ): Promise<{ readonly body: string; readonly metadata: string }> {
    const validKey = validateKey(key)
    const root = await this.#secureRoot(createRoot)
    const body = resolve(root, `sha256-${createHash('sha256').update(validKey).digest('hex')}`)
    return { body, metadata: `${body}${METADATA_SUFFIX}` }
  }

  async #secureRoot(create: boolean): Promise<string> {
    try {
      if (create) await mkdir(this.#root, { recursive: true, mode: 0o700 })
      const lexicalEntry = await lstat(this.#root)
      if (lexicalEntry.isSymbolicLink() || !lexicalEntry.isDirectory()) integrityFailure()
      const canonicalRoot = this.#canonicalRoot ?? (await realpath(this.#root))
      const canonicalEntry = await lstat(canonicalRoot)
      if (!canonicalEntry.isDirectory() || (canonicalEntry.mode & 0o077) !== 0) integrityFailure()
      if (this.#canonicalRoot === undefined) {
        this.#canonicalRoot = canonicalRoot
        this.#rootDevice = canonicalEntry.dev
        this.#rootInode = canonicalEntry.ino
      } else if (
        canonicalRoot !== this.#canonicalRoot ||
        canonicalEntry.dev !== this.#rootDevice ||
        canonicalEntry.ino !== this.#rootInode
      ) {
        integrityFailure()
      }
      return canonicalRoot
    } catch (error) {
      if (error instanceof ObjectStoreError) throw error
      if (isMissing(error)) notFound()
      throw providerFailure()
    }
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

async function assertRegularFile(path: string): Promise<void> {
  let entry: Awaited<ReturnType<typeof lstat>>
  try {
    entry = await lstat(path)
  } catch (error) {
    if (isMissing(error)) notFound()
    throw providerFailure()
  }
  if (entry.isSymbolicLink() || !entry.isFile()) integrityFailure()
}

async function assertRegularFileOrMissing(path: string): Promise<void> {
  try {
    const entry = await lstat(path)
    if (entry.isSymbolicLink() || !entry.isFile()) integrityFailure()
  } catch (error) {
    if (isMissing(error)) return
    if (error instanceof ObjectStoreError) throw error
    throw providerFailure()
  }
}

async function openNoFollow(path: string): ReturnType<typeof open> {
  if (constants.O_NOFOLLOW === undefined) throw providerFailure()
  return open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
}

async function writeExclusive(path: string, body: Uint8Array | string): Promise<void> {
  if (constants.O_NOFOLLOW === undefined) throw providerFailure()
  const handle = await open(
    path,
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
    0o600
  )
  try {
    await handle.writeFile(body)
  } finally {
    await handle.close()
  }
}

function isMissing(error: unknown): boolean {
  return errorCode(error) === 'ENOENT'
}

function isSymlinkLoop(error: unknown): boolean {
  return errorCode(error) === 'ELOOP'
}

function errorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) return undefined
  return typeof error.code === 'string' ? error.code : undefined
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
