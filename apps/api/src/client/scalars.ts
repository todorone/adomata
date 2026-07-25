import { z } from 'zod'

export const isoDate = z.string().datetime({ offset: true }).pipe(z.coerce.date())
