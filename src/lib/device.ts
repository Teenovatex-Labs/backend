// Turns a raw User-Agent string into something a person can recognise: "Chrome on Linux".
export type Device = { label: string; browser: string; os: string; kind: 'phone' | 'tablet' | 'computer' | 'unknown' };

export function describeDevice(ua: string | null | undefined): Device {
  if (!ua) return { label: 'Unknown device', browser: 'Unknown browser', os: 'Unknown system', kind: 'unknown' };

  const browser =
    /Edg(e|A|iOS)?\//.test(ua) ? 'Edge'
    : /OPR\/|Opera/.test(ua) ? 'Opera'
    : /SamsungBrowser\//.test(ua) ? 'Samsung Internet'
    : /Firefox\/|FxiOS\//.test(ua) ? 'Firefox'
    : /CriOS\/|Chrome\//.test(ua) ? 'Chrome'
    : /Safari\//.test(ua) ? 'Safari'
    : 'Browser';

  const os =
    /Windows/.test(ua) ? 'Windows'
    : /Android/.test(ua) ? 'Android'
    : /iPhone|iPad|iPod/.test(ua) ? 'iOS'
    : /Mac OS X|Macintosh/.test(ua) ? 'macOS'
    : /CrOS/.test(ua) ? 'ChromeOS'
    : /Linux/.test(ua) ? 'Linux'
    : 'Unknown system';

  const kind: Device['kind'] = /iPad|Tablet/.test(ua) || (/Android/.test(ua) && !/Mobile/.test(ua))
    ? 'tablet'
    : /iPhone|iPod|Android|Mobile/.test(ua) ? 'phone'
    : os === 'Unknown system' ? 'unknown' : 'computer';

  return { label: `${browser} on ${os}`, browser, os, kind };
}
