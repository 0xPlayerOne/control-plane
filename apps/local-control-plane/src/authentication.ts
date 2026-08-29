import { randomBytes, timingSafeEqual } from 'node:crypto'
import { chmod, lstat, mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { ServicePrincipalSchema, type ServicePrincipal } from '@control-plane/contracts'
import type { ServiceAuthenticator } from '@control-plane/control-api'
import type { FastifyRequest } from 'fastify'
import { BadRequestException, UnauthorizedException } from '@nestjs/common'

export interface LocalApiAuthentication {
  readonly authenticator: ServiceAuthenticator
  readonly credentialFile: string
}

export async function createLocalApiAuthentication(
  dataDirectory: string
): Promise<LocalApiAuthentication> {
  const directory = join(dataDirectory, 'auth')
  const credentialFile = join(directory, 'local-api.token')
  await mkdir(directory, { recursive: true, mode: 0o700 })
  await chmod(directory, 0o700)
  let credential: string
  try {
    credential = (await readFile(credentialFile, 'utf8')).trim()
    const info = await lstat(credentialFile)
    if (!info.isFile() || info.isSymbolicLink() || (info.mode & 0o077) !== 0) {
      throw new Error('LOCAL_API_CREDENTIAL_UNSAFE')
    }
  } catch (error) {
    if (error instanceof Error && error.message === 'LOCAL_API_CREDENTIAL_UNSAFE') throw error
    credential = randomBytes(32).toString('base64url')
    try {
      await writeFile(credentialFile, `${credential}\n`, { flag: 'wx', mode: 0o600 })
    } catch {
      credential = (await readFile(credentialFile, 'utf8')).trim()
    }
    await chmod(credentialFile, 0o600)
  }
  if (!/^[A-Za-z0-9_-]{43}$/.test(credential)) throw new Error('LOCAL_API_CREDENTIAL_INVALID')
  return {
    authenticator: new LocalBearerAuthenticator(credential),
    credentialFile,
  }
}

class LocalBearerAuthenticator implements ServiceAuthenticator {
  readonly #credential: Buffer

  constructor(credential: string) {
    this.#credential = Buffer.from(credential)
  }

  async authenticate(
    request: FastifyRequest,
    requiredScopes: readonly string[]
  ): Promise<ServicePrincipal> {
    const supplied = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(request.headers.authorization ?? '')?.[1]
    const suppliedBytes = Buffer.from(supplied ?? '')
    if (
      suppliedBytes.length !== this.#credential.length ||
      !timingSafeEqual(suppliedBytes, this.#credential)
    ) {
      throw new UnauthorizedException({
        code: 'LOCAL_API_AUTHENTICATION_FAILED',
        message: 'Local API credential was rejected',
      })
    }
    const body = request.body
    if (typeof body !== 'object' || body === null) {
      throw new BadRequestException({
        code: 'LOCAL_API_ENVELOPE_REQUIRED',
        message: 'A versioned local service envelope is required',
      })
    }
    const value = body as Readonly<Record<string, unknown>>
    const caller = value['caller']
    const principalId =
      typeof caller === 'object' && caller !== null
        ? Reflect.get(caller, 'servicePrincipalId')
        : undefined
    if (principalId !== 'svc_agent-hq') {
      throw new UnauthorizedException({
        code: 'LOCAL_API_CALLER_INVALID',
        message: 'Local API caller was rejected',
      })
    }
    const workspaceId = value['workspaceId']
    const projectId = value['projectId']
    return ServicePrincipalSchema.parse({
      kind: 'agent_hq_service',
      principalId,
      scopes: [...requiredScopes],
      workspaceIds: typeof workspaceId === 'string' ? [workspaceId] : [],
      projectIds: typeof projectId === 'string' ? [projectId] : [],
    })
  }
}
