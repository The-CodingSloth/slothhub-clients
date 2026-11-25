// The size rule for public gallery images. It has no dependencies because browser
// code imports it: keep schema and review logic in galleryImageReview.ts.

// Below this an image is an icon or logo, not a screenshot: the public gallery
// leaves it out rather than show a speck in an empty stage.
export const GALLERY_IMAGE_MIN_WIDTH = 320;
export const GALLERY_IMAGE_MIN_HEIGHT = 180;

export interface GalleryImageSize {
  width: number;
  height: number;
}

export const isGalleryImageLargeEnough = ({
  width,
  height,
}: GalleryImageSize) =>
  width >= GALLERY_IMAGE_MIN_WIDTH && height >= GALLERY_IMAGE_MIN_HEIGHT;

/** Message for an image the public gallery leaves out; null when it is large enough. */
export const galleryImageSizeError = (size: GalleryImageSize): string | null =>
  isGalleryImageLargeEnough(size)
    ? null
    : `This image is ${size.width}×${size.height}. Gallery images must be at least ${GALLERY_IMAGE_MIN_WIDTH}×${GALLERY_IMAGE_MIN_HEIGHT}.`;

/** Sanity image asset ids encode intrinsic size: image-<id>-<width>x<height>-<ext>. */
export const parseSanityImageAssetSize = (
  assetRef: string,
): GalleryImageSize | null => {
  const match = /^image-[A-Za-z0-9]+-([1-9]\d*)x([1-9]\d*)-[a-z0-9]+$/.exec(
    assetRef,
  );
  return match ? { width: Number(match[1]), height: Number(match[2]) } : null;
};
