import express from 'express'; import cors from 'cors'; import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
const app = express(); app.use(cors(), express.json());
const CONFIRM_MS = (+process.env.CONFIRM_SECONDS || 10) * 1000;
const sb = process.env.SUPABASE_URL && process.env.SUPABASE_KEY ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY) : null;
const T = ['Harassment', 'Poor lighting', 'Theft', 'Stalking', 'Unsafe crowd'];
async function notify(d, reason) {
  if (!process.env.NTFY_TOPIC) return 'ntfy not configured';
  const link = `https://maps.google.com/?q=${d.lat},${d.lng}`;
  try {
    await fetch(`https://ntfy.sh/${process.env.NTFY_TOPIC}`, {
      method: 'POST',
      headers: { Title: 'SafeGuard AI emergency', Priority: 'urgent', Tags: 'rotating_light', Click: link },
      body: `${reason}. Tap to open the location: ${link}`
    });
    return 'ntfy sent';
  } catch { return 'ntfy failed'; }
}
const hot = [...Array(7)].map((_, i) => ({ id: 100 + i, type: i % 2 ? 'Harassment' : 'Stalking', lat: 28.6315 + Math.sin(i) * .0007, lng: 77.2167 + Math.cos(i) * .0008, created_at: new Date(Date.now() - i * 3 * 36e5).toISOString(), confirms: 2 }));
const seed = [...[...Array(28)].map((_, i) => ({ id: i + 1, type: T[i % 5], lat: 28.6139 + Math.sin(i * 7) * .012 + (i % 3 ? .004 : 0), lng: 77.209 + Math.cos(i * 5) * .014, created_at: new Date(Date.now() - i * 8 * 36e5).toISOString(), confirms: i % 4 })), ...hot];
const mem = { incidents: seed, alerts: [], contacts: [{ id: 1, name: 'Mom', phone: '+91 90000 00001' }], sensor_logs: [] };
const list = async t => sb ? (await sb.from(t).select('*').order('created_at', { ascending: false }).limit(200)).data || [] : mem[t];
const add = async (t, r) => { r = { ...r }; if (sb) return (await sb.from(t).insert(r).select().single()).data; Object.assign(r, { id: Date.now() + Math.random(), created_at: new Date().toISOString() }); mem[t].unshift(r); return r; };
const patch = async (t, id, p) => sb ? (await sb.from(t).update(p).eq('id', id).select().single()).data : Object.assign(mem[t].find(x => x.id == id) || {}, p);
const cancelled = new Set();
const reporter = new Map(), confirmers = new Map(), daily = new Map();
const dist = (a, b, c, d) => { const R = 6371e3, r = x => x * Math.PI / 180, h = Math.sin(r(c - a) / 2) ** 2 + Math.cos(r(a)) * Math.cos(r(c)) * Math.sin(r(d - b) / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(h)); };
const rules = ({ accel = 0, sound = 0, sos }) => sos ? 1 : Math.min(1, (accel > 2.5 ? .55 : accel / 5) + (sound > 75 ? .5 : sound / 200));
async function classify(d) {
  const score = rules(d), base = { distress: score >= .7, score, reason: 'rule-based check', by: 'rules' };
  if (!process.env.GEMINI_API_KEY || d.sos) return base;
  try {
    const p = `Wearable safety sensor reading: acceleration ${d.accel} g (walking ~1.1, fall/struggle >2.5), ambient sound ${d.sound} dB (speech ~60, scream >80). Is this genuine distress? Reply JSON only: {"distress":boolean,"confidence":0-1,"reason":"short"}`;
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ contents: [{ parts: [{ text: p }] }], generationConfig: { responseMimeType: 'application/json' } }) });
    const j = JSON.parse((await r.json()).candidates[0].content.parts[0].text);
    return { distress: !!j.distress, score: j.confidence ?? score, reason: j.reason, by: 'gemini' };
  } catch { return base; }
}
app.post('/sensor-data', async (req, res) => {
  const d = req.body; await add('sensor_logs', { accel: d.accel, sound: d.sound, lat: d.lat, lng: d.lng, sos: !!d.sos });
  if ((await list('alerts')).some(a => a.status === 'pending')) return res.json({ distress: true, note: 'alert already pending' });
  const c = await classify(d); if (!c.distress) return res.json(c);
  const alert = await add('alerts', { status: 'pending', score: c.score, reason: `${c.by}: ${d.reason || c.reason}`, lat: d.lat, lng: d.lng, deadline: new Date(Date.now() + CONFIRM_MS).toISOString() });
  setTimeout(async () => {
    if (cancelled.has(alert.id)) return;
    const contacts = await list('contacts');
    await patch('alerts', alert.id, { status: 'sent', notified: contacts.map(x => x.name) });
    console.log(await notify(d, c.reason));
    console.log(`ALERT SENT to ${contacts.map(x => x.phone)} @ ${d.lat},${d.lng}`);
  }, CONFIRM_MS);
  res.json({ ...c, alert });
});
app.post('/alerts/:id/cancel', async (req, res) => { cancelled.add(+req.params.id); cancelled.add(req.params.id); res.json(await patch('alerts', req.params.id, { status: 'cancelled' })); });
app.post('/incidents/:id/confirm', async (req, res) => {
  const id = String(req.params.id), device = req.body.device || 'anon', seen = confirmers.get(id) || new Set();
  if (reporter.get(id) === device) return res.status(400).json({ error: "You can't confirm your own report." });
  if (seen.has(device)) return res.status(400).json({ error: 'You already confirmed this report.' });
  seen.add(device); confirmers.set(id, seen);
  const cur = (await list('incidents')).find(x => x.id == id); res.json(await patch('incidents', id, { confirms: (cur?.confirms || 0) + 1 }));
});
app.get('/alerts', async (_, res) => res.json(await list('alerts')));
app.get('/incidents', async (_, res) => res.json(await list('incidents')));
app.post('/incidents', async (req, res) => {
  const { type, lat, lng, anonymous = true, device = 'anon', userLat, userLng } = req.body;
  if (!T.includes(type)) return res.status(400).json({ error: 'Choose a valid report type.' });
  if (userLat == null || dist(lat, lng, userLat, userLng) > 200) return res.status(400).json({ error: 'You can only report within 200 m of your current location.' });
  const day = (daily.get(device) || []).filter(t => Date.now() - t < 864e5);
  if (day.length >= 3) return res.status(429).json({ error: 'Daily limit reached: 3 reports per day.' });
  daily.set(device, [...day, Date.now()]);
  const q = v => anonymous ? +v.toFixed(3) : v, row = await add('incidents', { type, lat: q(lat), lng: q(lng), anonymous, confirms: 0 });
  reporter.set(String(row.id), device); res.json(row);
});
app.get('/contacts', async (_, res) => res.json(await list('contacts')));
app.post('/contacts', async (req, res) => res.json(await add('contacts', { name: req.body.name, phone: req.body.phone })));
app.listen(process.env.PORT || 4000, () => console.log(`SafeGuard backend on :${process.env.PORT || 4000} (${sb ? 'Supabase' : 'in-memory'})`));
