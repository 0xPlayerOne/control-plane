import { z } from 'zod'

export const CursorSchema = z
  .string()
  .min(8)
  .max(512)
  .regex(/^cur_[A-Za-z0-9_-]+$/)

export interface CursorPosition {
  readonly sortKey: string
  readonly id: string
}

export function encodeCursor(position: CursorPosition): string {
  if (!position.sortKey || !position.id) throw new Error('INVALID_CURSOR_POSITION')
  const payload = JSON.stringify({ id: position.id, sortKey: position.sortKey })
  return `cur_${Buffer.from(payload, 'utf8').toString('base64url')}`
}

export function decodeCursor(cursor: string): CursorPosition {
  CursorSchema.parse(cursor)
  let value: unknown
  try {
    value = JSON.parse(Buffer.from(cursor.slice(4), 'base64url').toString('utf8'))
  } catch {
    throw new Error('INVALID_CURSOR')
  }
  const parsed = z.object({ sortKey: z.string().min(1), id: z.string().min(1) }).safeParse(value)
  if (!parsed.success) throw new Error('INVALID_CURSOR')
  return parsed.data
}

export const PageSchema = z.object({ nextCursor: CursorSchema.optional() })

export type Cursor = z.output<typeof CursorSchema>
