import {
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  timestamp,
  varchar,
} from 'drizzle-orm/pg-core'
import { executionEvents } from './events.js'
import { runtimeCommands } from './runtime-commands.js'

export const runtimeEventMessageKind = pgEnum('runtime_event_message_kind', [
  'progress',
  'terminal',
])
export const runtimeEventReceiptOutcome = pgEnum('runtime_event_receipt_outcome', [
  'applied',
  'out_of_order',
  'terminal_conflict',
])

export const runtimeEventReceipts = pgTable(
  'runtime_event_receipts',
  {
    commandId: varchar('command_id', { length: 30 })
      .notNull()
      .references(() => runtimeCommands.commandId),
    messageKind: runtimeEventMessageKind('message_kind').notNull(),
    messageSequence: integer('message_sequence').notNull(),
    frameHash: varchar('frame_hash', { length: 71 }).notNull(),
    outcome: runtimeEventReceiptOutcome('outcome').notNull(),
    eventId: varchar('event_id', { length: 30 }).references(() => executionEvents.eventId),
    recordedAt: timestamp('recorded_at', { mode: 'date', withTimezone: true }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.commandId, table.messageKind, table.messageSequence] }),
    index('runtime_event_receipts_progress_order_index').on(
      table.commandId,
      table.messageKind,
      table.messageSequence
    ),
    index('runtime_event_receipts_event_index').on(table.eventId),
  ]
)
