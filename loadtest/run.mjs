// Load test for the API. Run it against a LOCAL or STAGING backend, never production.
//   BASE=http://localhost:4000 EMAIL=... PASSWORD=... node loadtest/run.mjs
// Each request pretends to come from a different address (X-Forwarded-For) so the per-IP rate limit,
// which should stay on in production, doesn't swamp what we are trying to measure: database and code speed.
import autocannon from 'autocannon';

const BASE = process.env.BASE ?? 'http://localhost:4000';
if (/teenovatex\.org/.test(BASE)) throw new Error('Refusing to load-test production.');
const login = await fetch(`${BASE}/api/v1/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: process.env.EMAIL, password: process.env.PASSWORD }),
}).then((r) => r.json());
const token = login.access_token;
if (!token) throw new Error('Could not sign in: ' + JSON.stringify(login));

const endpoints = ['/health/ready', '/api/v1/projects?limit=20', '/api/v1/leaderboard', '/api/v1/notifications', '/api/v1/events'];
// Search is deliberately limited to 60 a minute per member, so it is not part of a throughput test.
const ip = () => `10.${(Math.random() * 250) | 0}.${(Math.random() * 250) | 0}.${(Math.random() * 250) | 0}`;
const results = [];
for (const path of endpoints) {
  const r = await autocannon({
    url: BASE + path,
    connections: Number(process.env.CONNECTIONS ?? 50),
    duration: Number(process.env.DURATION ?? 8),
    requests: [{ setupRequest: (req) => ({ ...req, headers: { Authorization: `Bearer ${token}`, 'X-Forwarded-For': ip() } }) }],
  });
  results.push({ path, rps: Math.round(r.requests.average), p50: r.latency.p50, p99: r.latency.p99, ok: r['2xx'], bad: r.non2xx, errors: r.errors });
}
console.table(results);
const bad = results.filter((x) => x.bad > 0 || x.errors > 0 || x.p99 > 500);
if (bad.length) {
  console.error('Over budget or failing:', bad.map((x) => x.path).join(', '));
  process.exit(1);
}
