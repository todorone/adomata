import { parseMetaConfig } from '../config'
import { seedFakeMetaRoster } from './roster'

if (process.env.NODE_ENV === 'production') throw new Error('The fake Meta seed cannot run in production')
if (parseMetaConfig().mode !== 'fake') throw new Error('META_API_MODE must be fake to seed the fake Meta roster')

await seedFakeMetaRoster()
console.log('fake Meta roster seeded into HQ')
