// Roughly where an IP address is, using a database that ships with the app. The address never leaves
// our server, which matters on a platform for teenagers. The data is coarse: usually the country,
// sometimes the city. It is loaded on first use because it is big.
const regions = new Intl.DisplayNames(['en'], { type: 'region' });

type Lookup = (ip: string) => { country?: string; city?: string } | null;
let lookup: Promise<Lookup> | undefined;
const load = (): Promise<Lookup> =>
  (lookup ??= import('geoip-lite').then((m) => (m.default ?? m).lookup as Lookup).catch(() => () => null));

export async function describeLocation(ip: string | null | undefined): Promise<string | null> {
  if (!ip) return null;
  const clean = ip.replace(/^::ffff:/, '');
  const hit = (await load())(clean);
  if (!hit?.country) return null;
  let country: string = hit.country;
  try {
    country = regions.of(hit.country) ?? hit.country;
  } catch {
    // keep the two-letter code
  }
  return hit.city ? `${hit.city}, ${country}` : country;
}
