import { z } from "zod";
import type { JsonValue } from "./jsonValue.js";
import {
  GALLERY_IMAGE_MIN_WIDTH,
  GALLERY_IMAGE_MIN_HEIGHT,
  isGalleryImageLargeEnough,
  parseSanityImageAssetSize,
} from "./galleryImageSize.js";

export const galleryImageReviewSchema = z.object({
  assetRef: z.string().min(1),
  checkedAt: z.iso.datetime({ offset: true }),
  phrases: z.array(z.string().min(1)),
});
export type GalleryImageReview = z.infer<typeof galleryImageReviewSchema>;

// Specific phrases only: generic UI words such as “sign up” or “cookie” also
// occur in useful product screenshots. Keep this advisory list reviewable.
const PHRASES =
  /\b(?:we use cookies|accept (?:all )?cookies|cookie (?:consent|preferences)|manage (?:cookie|consent) preferences|reject all|\d+\s*%\s*off|limited time offer|sign up today|buy now|the future of|supercharge your|revolutionize your)\b/gi;

export const findGalleryImagePhrases = (text: string): string[] => {
  const matches = text.replace(/\s+/g, " ").match(PHRASES) ?? [];
  return [
    ...new Map(
      matches.map((phrase) => [phrase.toLowerCase(), phrase]),
    ).values(),
  ];
};

export {
  GALLERY_IMAGE_MIN_WIDTH,
  GALLERY_IMAGE_MIN_HEIGHT,
  isGalleryImageLargeEnough,
  galleryImageSizeError,
  parseSanityImageAssetSize,
  type GalleryImageSize,
} from "./galleryImageSize.js";

export type GalleryImageReviewWarning = {
  key?: string;
  index: number;
  message: string;
};
const galleryReviewInputSchema = z.array(
  z.object({
    _key: z.string().optional(),
    type: z.string().nullish(),
    caption: z.string().nullish(),
    image: z
      .object({
        asset: z.object({ _ref: z.string().optional() }).nullish(),
        review: z.json().optional(),
      })
      .nullish(),
  }),
);

type GalleryReviewItem = z.infer<typeof galleryReviewInputSchema>[number];
const galleryImageLabel = (item: GalleryReviewItem, index: number) =>
  `Gallery image ${index + 1}${item.caption?.trim() ? ` (${item.caption.trim()})` : ""}`;

/** Text-check warnings only; feature screenshots reuse these without the gallery size rule. */
export const getGalleryImageTextReviewWarnings = (
  gallery: JsonValue,
): GalleryImageReviewWarning[] => {
  const parsed = galleryReviewInputSchema.safeParse(gallery);
  if (!parsed.success) return [];
  return parsed.data.flatMap((item, index) => {
    const assetRef = item.image?.asset?._ref;
    if (item.type !== "image" || !assetRef) return [];
    const label = galleryImageLabel(item, index);
    const review = galleryImageReviewSchema.safeParse(item.image?.review);
    if (!review.success || review.data.assetRef !== assetRef) {
      return [
        {
          key: item._key,
          index,
          message: `${label} has not been checked for consent dialogs, promotions or slogans. Run the image text check in Studio or review the screenshot manually.`,
        },
      ];
    }
    return review.data.phrases.length
      ? [
          {
            key: item._key,
            index,
            message: `${label} contains ${review.data.phrases.map((phrase) => `“${phrase}”`).join(", ")}. Review the screenshot and replace it with an uncluttered product view if needed.`,
          },
        ]
      : [];
  });
};

/** Size and text-check advice for the public media gallery. */
export const getGalleryImageReviewWarnings = (
  gallery: JsonValue,
): GalleryImageReviewWarning[] => {
  const parsed = galleryReviewInputSchema.safeParse(gallery);
  if (!parsed.success) return [];
  const size = parsed.data.flatMap((item, index) => {
    const assetRef = item.image?.asset?._ref;
    const dimensions =
      item.type === "image" && assetRef
        ? parseSanityImageAssetSize(assetRef)
        : null;
    if (!dimensions || isGalleryImageLargeEnough(dimensions)) return [];
    return [
      {
        key: item._key,
        index,
        message: `${galleryImageLabel(item, index)} is ${dimensions.width}×${dimensions.height}. Images smaller than ${GALLERY_IMAGE_MIN_WIDTH}×${GALLERY_IMAGE_MIN_HEIGHT} are left out of the public gallery. Upload a larger screenshot or remove it.`,
      },
    ];
  });
  return [...size, ...getGalleryImageTextReviewWarnings(gallery)].sort(
    (a, b) => a.index - b.index,
  );
};
