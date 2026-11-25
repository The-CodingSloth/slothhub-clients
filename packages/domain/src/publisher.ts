import {z} from 'zod'
import type {JsonValue} from './jsonValue.js'
import {containsUnsafePublicTextCharacters} from './publicText.js'
import {isReservedRootSlug} from './reservedRootSlugs.js'
import {validatePublicHttpUrl} from './urlSafety.js'
import {MAX_PUBLIC_METADATA_LABEL_LENGTH, MAX_PUBLIC_METADATA_URL_LENGTH} from './publicMetadata.js'

const publisherText = (max: number) => z.string().trim().min(1).max(max).refine(
  (value) => !containsUnsafePublicTextCharacters(value),
  'Remove control and bidirectional characters from public text.',
)
const publisherUrl = z.url().max(MAX_PUBLIC_METADATA_URL_LENGTH).refine(
  (value) => value.startsWith('https://') && validatePublicHttpUrl(value).success,
  'Use a public HTTPS URL without credentials.',
)

export const publisherSlugSchema = z.string().max(96).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).refine(
  (slug) => !isReservedRootSlug(slug),
  'This slug is reserved for a SlothHub route. Choose another slug.',
)

export const publicPublisherIdentitySchema = z.object({
  name: publisherText(MAX_PUBLIC_METADATA_LABEL_LENGTH),
  slug: publisherSlugSchema,
  website: publisherUrl,
  profileUrl: z.url().max(MAX_PUBLIC_METADATA_URL_LENGTH).refine((value) => {
    const url = new URL(value)
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password
  }, 'Use an HTTP or HTTPS Publisher profile URL without credentials.'),
})
export type PublicPublisherIdentity = z.infer<typeof publicPublisherIdentitySchema>

const publisherIdentitySourceSchema = publicPublisherIdentitySchema.omit({profileUrl: true}).extend({
  _id: z.string().min(1).refine((id) => !id.startsWith('drafts.'), 'Publish the Publisher before referencing it.'),
  kind: z.literal('organization'),
  approved: z.literal(true),
  noIndex: z.literal(false),
}).strip()
type PublisherIdentitySource = z.infer<typeof publisherIdentitySourceSchema>

const publisherIdentity = (source: PublisherIdentitySource): PublicPublisherIdentity => ({
  name: source.name,
  slug: source.slug,
  website: new URL(source.website).href,
  profileUrl: new URL(source.website).href,
})

/** Only approved editorial organizations can become public Tool identities. */
export const normalizePublicPublisherIdentity = (
  value: JsonValue,
  _siteUrl: string,
): PublicPublisherIdentity | null => {
  const result = publisherIdentitySourceSchema.safeParse(value)
  return result.success ? publisherIdentity(result.data) : null
}
