import { setupServer } from 'msw/node'

import { fakeMetaHandlers } from './handlers'

export const fakeMetaServer = setupServer(...fakeMetaHandlers)
