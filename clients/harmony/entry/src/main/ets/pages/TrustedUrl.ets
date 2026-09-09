import { url } from '@kit.ArkTS';

export function isTrustedJishiUrl(value: string): boolean {
  try {
    const parsed = new url.URL(value);
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || (parsed.port && parsed.port !== '443')) return false;
    if (parsed.hostname === 'jishi.awaqwq233.com') return true;
    return parsed.hostname === 'awaqwq233.com' && (parsed.pathname === '/note' || parsed.pathname.startsWith('/note/'));
  } catch (_) { return false; }
}
