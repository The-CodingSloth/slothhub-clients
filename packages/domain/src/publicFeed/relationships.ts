import { RESOURCE_KIND_VALUES } from '../resourceKind.js';
import {
  RESOURCE_RELATIONSHIP_DIRECTION_VALUES,
  RESOURCE_RELATIONSHIP_KIND_VALUES,
  getResourceRelationshipLabel,
} from '../resourceRelationship.js';
import { isSafePublicText } from '../publicText.js';
import { normalizePublicSourceReferenceUrl } from '../sourceReference.js';
import { z } from 'zod';

const safeRelationshipLabelSchema = z
  .string()
  .min(1)
  .refine(
    isSafePublicText,
    'Relationship labels must exclude control or bidirectional formatting characters',
  );

const publicRelationshipUrlSchema = z
  .string()
  .refine(
    (value) => normalizePublicSourceReferenceUrl(value) === value,
    'Relationship URLs must be canonical public HTTP or HTTPS URLs',
  );

export const resourceKindReferenceSchema = z.object({
  value: z.string(),
  label: z.string(),
});

export const resourceIdentitySchema = z.object({
  kind: z.string(),
  kindLabel: z.string(),
  canonicalUrl: z.string(),
  ctaLabel: z.string(),
  registryId: z.string().optional(),
  websiteUrl: z.string().optional(),
  repositoryUrl: z.string().optional(),
  docsUrl: z.string().optional(),
  packageUrl: z.string().optional(),
  mcpRegistryUrl: z.string().optional(),
});

export const resourceRelationshipSchema = z
  .object({
    kind: z.enum(RESOURCE_RELATIONSHIP_KIND_VALUES),
    direction: z.enum(RESOURCE_RELATIONSHIP_DIRECTION_VALUES),
    label: safeRelationshipLabelSchema,
    target: z
      .object({
        id: z.string().min(1),
        name: safeRelationshipLabelSchema,
        slug: z.string().min(1),
        canonicalUrl: publicRelationshipUrlSchema,
        resourceKind: resourceKindReferenceSchema.extend({
          value: z.enum(RESOURCE_KIND_VALUES),
        }),
      })
      .strict(),
    evidenceUrl: publicRelationshipUrlSchema.optional(),
  })
  .strict()
  .superRefine((relationship, context) => {
    if (
      relationship.label !== getResourceRelationshipLabel(relationship.kind, relationship.direction)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['label'],
        message: 'Relationship label must match its kind and direction',
      });
    }
  });
