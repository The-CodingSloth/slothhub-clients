import {isLocalFeedUrl} from '@slothhub/domain/feed-origin';
import {validateAbsoluteHttpUrl} from '@slothhub/domain/url-safety';

/** Catalog citations support local development and exclude tracked visit links. */
export const isSafeCatalogCitationUrl = (value: string | undefined, siteUrl: string): value is string => {
  if (!value || !validateAbsoluteHttpUrl(value).success) return false;
  const {pathname, protocol} = new URL(value);
  return (protocol === 'https:' || isLocalFeedUrl(value, siteUrl)) && pathname !== '/go' && !pathname.startsWith('/go/');
};
