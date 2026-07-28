import { z } from 'zod'

export const discoveredMetaAccountSchema = z.object({
	metaAccountId: z.string(),
	name: z.string(),
	currency: z.string(),
	timezoneName: z.string().nullable(),
	connected: z.boolean(),
	clientId: z.string().nullable(),
	clientName: z.string().nullable(),
})
export type DiscoveredMetaAccount = z.infer<typeof discoveredMetaAccountSchema>

export const metaAccountsDiscoveryResponseSchema = z.object({
	accounts: z.array(discoveredMetaAccountSchema),
	clients: z.array(z.object({ id: z.string(), name: z.string() })),
})
export type MetaAccountsDiscoveryResponse = z.infer<typeof metaAccountsDiscoveryResponseSchema>

export const connectMetaAccountItemSchema = z
	.object({
		metaAccountId: z.string().min(1),
		name: z.string().min(1),
		currency: z.string().min(1),
		timezoneName: z.string().nullable(),
		clientId: z.string().min(1).optional(),
		newClientName: z.string().trim().min(1).optional(),
	})
	.refine(item => Boolean(item.clientId) !== Boolean(item.newClientName), {
		message: 'Provide exactly one of clientId or newClientName',
	})
export type ConnectMetaAccountItem = z.infer<typeof connectMetaAccountItemSchema>

export const connectMetaAccountsBodySchema = z.object({
	accounts: z.array(connectMetaAccountItemSchema).min(1),
})
export type ConnectMetaAccountsBody = z.infer<typeof connectMetaAccountsBodySchema>

export const connectMetaAccountsResponseSchema = z.object({ connected: z.number().int() })
export type ConnectMetaAccountsResponse = z.infer<typeof connectMetaAccountsResponseSchema>
