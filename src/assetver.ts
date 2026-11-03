declare const __APP_COMMIT__: string;
/** Cache-buster for every fetched asset: the build commit, so each release fetches fresh models/world
 *  files even when the world export marker (READY) didn't change (e.g. a characters-only release). */
export const ASSET_V = typeof __APP_COMMIT__ === 'string' ? __APP_COMMIT__ : 'dev';
export const bust = (url: string) => url + (url.includes('?') ? '&' : '?') + 'b=' + encodeURIComponent(ASSET_V);
