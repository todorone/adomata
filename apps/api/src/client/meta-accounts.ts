import { z } from 'zod'

export const discoveredMetaAccountSchema = z.object({
	metaAccountId: z.string(),
	name: z.string(),
	currency: z.string(),
	timezoneName: z.string().nullable(),
	connected: z.boolean(),
	clientId: z.string().nullable(),
	clientName: z.string().nullable(),
	businessId: z.string().nullable(),
	businessName: z.string().nullable(),
})
export type DiscoveredMetaAccount = z.infer<typeof discoveredMetaAccountSchema>

export const metaAccountsDiscoveryResponseSchema = z.object({
	accounts: z.array(discoveredMetaAccountSchema),
})
export type MetaAccountsDiscoveryResponse = z.infer<typeof metaAccountsDiscoveryResponseSchema>

export const connectMetaAccountItemSchema = z.object({
	metaAccountId: z.string().min(1),
	name: z.string().min(1),
	currency: z.string().min(1),
	timezoneName: z.string().nullable(),
	businessId: z.string().nullable().optional(),
	businessName: z.string().nullable().optional(),
})
export type ConnectMetaAccountItem = z.infer<typeof connectMetaAccountItemSchema>

export const connectMetaAccountsBodySchema = z.object({
	accounts: z.array(connectMetaAccountItemSchema).min(1),
})
export type ConnectMetaAccountsBody = z.infer<typeof connectMetaAccountsBodySchema>

export const connectMetaAccountsResponseSchema = z.object({ connected: z.number().int() })
export type ConnectMetaAccountsResponse = z.infer<typeof connectMetaAccountsResponseSchema>

export const resyncMetaAccountsResponseSchema = z.object({ acknowledged: z.literal(true) })
export type ResyncMetaAccountsResponse = z.infer<typeof resyncMetaAccountsResponseSchema>
