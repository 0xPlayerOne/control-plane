import process from 'node:process'
import { loadDatabaseCredentials } from '@control-plane/config'
import { migrateDatabase } from '../migration.js'

await migrateDatabase(loadDatabaseCredentials(process.env, 'migration'))
