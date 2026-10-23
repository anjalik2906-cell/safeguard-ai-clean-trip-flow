import { useEffect, useMemo, useRef, useState } from 'react';
import L from './lglobal.js'; import 'leaflet.heat';
const API = import.meta.env.VITE_API || 'http://localhost:4000';
const api = (p, o) => fetch(API + p, o && { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(o) }).then(r => r.json());
const device = (() => { try { let d = localStorage.getItem('sg_device'); if (!d) { d = Math.random().toString(36).slice(2) + Date.now().toString(36); localStorage.setItem('sg_device', d); } return d; } catch { return 'anon'; } })();
const HOME = [28.6139, 77.209], MODES = { foot: 'Walk', car: 'Drive', bike: 'Bike' }, LV = ['#7fd8be', '#f2b84b', '#ff5d73'];
const LINES = [['112', 'Emergency'], ['181', 'Women helpline'], ['1091', 'Women in distress']];
const km = m => m >= 1000 ? (m / 1000).toFixed(1) + ' km' : Math.round(m) + ' m';
const mins = s => { const m = Math.max(1, Math.round(s / 60)); return m >= 60 ? Math.floor(m / 60) + ' h ' + m % 60 + ' min' : m + ' min'; };
const ago = i => { const h = (Date.now() - new Date(i.created_at)) / 36e5; return h < 1 ? 'just now' : h < 48 ? Math.round(h) + ' h ago' : Math.round(h / 24) + ' d ago'; };
const wt = i => Math.min(2, Math.max(.15, Math.pow(.5, (Date.now() - new Date(i.created_at)) / 36e5 / 72)) * (1 + .25 * (i.confirms || 0))) * ((i.confirms || 0) >= 2 ? 1 : .3);
const near = (c, i) => Math.abs(c[1] - i.lat) < .0016 && Math.abs(c[0] - i.lng) < .0016;
const D = (a, b) => L.latLng(a[0], a[1]).distanceTo(L.latLng(b[0], b[1]));
const analyse = (r, inc, night) => {
  const m = night ? 1.6 : 1, cs = r.geometry.coordinates, segs = [], ids = new Map();
  for (let k = 0; k < cs.length - 1; k += 8) {
    const part = cs.slice(k, k + 9); let risk = 0, len = 0;
    inc.forEach(i => { if (part.some((c, q) => q % 2 === 0 && near(c, i))) { risk += wt(i); ids.set(i.id, wt(i)); } });
    for (let q = 1; q < part.length; q++) len += D([part[q - 1][1], part[q - 1][0]], [part[q][1], part[q][0]]);
    risk *= m; segs.push({ pts: part.map(c => [c[1], c[0]]), level: risk >= 1 ? 2 : risk >= .4 ? 1 : 0, len });
  }
  const total = [...ids.values()].reduce((a, b) => a + b, 0) * m;
  return { ...r, segs, n: ids.size, score: Math.max(5, Math.round(100 - total * 9)), redM: segs.filter(s => s.level === 2).reduce((a, s) => a + s.len, 0) };
};
const say = s => { const m = s.maneuver, t = m.type; const d = t === 'arrive' ? 'Arrive at destination' : t === 'depart' ? 'Head ' + (m.modifier || 'out') : t === 'roundabout' ? 'Take the roundabout' : ['turn', 'end of road', 'fork', 'on ramp', 'off ramp'].includes(t) ? 'Turn ' + (m.modifier || '') : 'Continue ' + (m.modifier || 'straight'); return d + (s.name && t !== 'arrive' ? ' on ' + s.name : ''); };
const tone = sc => sc >= 70 ? LV[0] : sc >= 45 ? LV[1] : LV[2];
const classify = e => { const t = e.tags || {}, a = t.amenity, kind = ['hospital', 'clinic', 'pharmacy', 'police'].includes(a) ? 'help' : (t.highway === 'bus_stop' || t.railway || t.public_transport) ? 'transit' : 'open'; return { id: e.id, lat: e.lat, lon: e.lon, kind, name: t.name || a || t.shop || t.railway || 'Stop', label: a || t.shop || t.railway || t.public_transport || 'bus stop', hours: t.opening_hours || null }; };

export default function App() {
  const [tab, setTab] = useState('map'), [inc, setInc] = useState([]), [alerts, setAlerts] = useState([]), [contacts, setContacts] = useState([]);
  const [pos, setPos] = useState(HOME), [from, setFrom] = useState({ name: 'Your location', ll: HOME }), [to, setTo] = useState(null);
  const [mode, setMode] = useState('foot'), [later, setLater] = useState(''), [raw, setRaw] = useState([]), [sel, setSel] = useState(null), [nav, setNav] = useState(false), [busy, setBusy] = useState(false);
  const [help, setHelp] = useState([]), [sh, setSh] = useState(40), [toast, setToast] = useState(''), [now, setNow] = useState(Date.now()), [net, setNet] = useState('WiFi');
  const [fac, setFac] = useState([]), [facBusy, setFacBusy] = useState(false), [facErr, setFacErr] = useState(false), [show, setShow] = useState({ help: true, open: true, transit: true }), [tick, setTick] = useState(0);
  const [edit, setEdit] = useState(true), [layersOpen, setLayersOpen] = useState(false), [routeErr, setRouteErr] = useState(false);
  useEffect(() => setEdit(!to), [to]);
  useEffect(() => setSh(to ? 40 : 22), [!!to]);
  const open = sh > 60, wrap = useRef();
  const dragStart = e => {
    e.preventDefault();
    let moved = false;
    const snap = v => [6, 40, 88].reduce((a, p) => Math.abs(p - v) < Math.abs(a - v) ? p : a);
    const move = ev => { moved = true; const b = wrap.current.getBoundingClientRect(); setSh(Math.min(90, Math.max(6, (b.bottom - ev.clientY) / b.height * 100))); };
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up); setSh(v => moved ? snap(v) : v < 20 ? 40 : v < 60 ? 88 : 40); };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up); window.addEventListener('pointercancel', up);
  };
  const mapEl = useRef(), map = useRef(), lay = useRef({}), holdT = useRef(), walk = useRef(), dev = useRef(false);
  const load = () => { api('/incidents').then(d => setInc(p => JSON.stringify(p.map(x => [x.id, x.confirms])) === JSON.stringify(d.map(x => [x.id, x.confirms])) ? p : d)).catch(() => { }); api('/alerts').then(setAlerts).catch(() => { }); api('/contacts').then(setContacts).catch(() => { }); };
  useEffect(() => { load(); const t = setInterval(() => { load(); setNow(Date.now()); }, 1500); return () => clearInterval(t); }, []);
  useEffect(() => { if (toast) { const t = setTimeout(() => setToast(''), 4000); return () => clearTimeout(t); } }, [toast]);
  useEffect(() => {
    const m = map.current = L.map(mapEl.current, { zoomControl: false }).setView(HOME, 14);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap contributors' }).addTo(m);
    lay.current = { routes: L.layerGroup().addTo(m), inc: L.layerGroup().addTo(m), help: L.layerGroup().addTo(m), fac: L.layerGroup().addTo(m), iso: L.layerGroup().addTo(m) };
    m.on('click', e => setTo({ name: 'Dropped pin', ll: [e.latlng.lat, e.latlng.lng] }));
    return () => m.remove();
  }, []);
  useEffect(() => { if (tab === 'map') setTimeout(() => map.current.invalidateSize(), 60); }, [tab]);
  useEffect(() => { lay.current.me?.remove(); lay.current.me = L.marker(pos, { icon: L.divIcon({ className: '', html: '<div class="me"></div>', iconSize: [16, 16] }), interactive: false }).addTo(map.current); if (nav) map.current.panTo(pos); }, [pos]);
  useEffect(() => { lay.current.start?.remove(); lay.current.start = L.circleMarker(from.ll, { radius: 9, color: '#fff', fillColor: '#2563eb', fillOpacity: 1, bubblingMouseEvents: false }).addTo(map.current); }, [from]);
  useEffect(() => { lay.current.dest?.remove(); lay.current.dest = to ? L.circleMarker(to.ll, { radius: 9, color: '#fff', fillColor: '#ff5d73', fillOpacity: 1, bubblingMouseEvents: false }).addTo(map.current) : null; }, [to]);
  useEffect(() => {
    lay.current.heat?.remove(); lay.current.heat = L.heatLayer(inc.map(i => [i.lat, i.lng, Math.min(1, wt(i))]), { radius: 28, blur: 22, gradient: { .3: '#7fd8be', .6: '#f2b84b', 1: '#ff5d73' } }).addTo(map.current);
    const g = lay.current.inc; g.clearLayers();
    inc.forEach(i => { const d = document.createElement('div'); d.innerHTML = `<b>${i.type}</b><br>${ago(i)} · ${(i.confirms || 0) >= 2 ? i.confirms + ' confirmed' : 'Unconfirmed (' + (i.confirms || 0) + ' of 2)'}<br>`; const b = document.createElement('button'); b.className = 'pbtn'; b.textContent = 'Confirm this report'; b.onclick = () => api(`/incidents/${i.id}/confirm`, { device }).then(x => { setToast(x.error || 'Thanks, report confirmed.'); load(); }); d.appendChild(b); L.circleMarker([i.lat, i.lng], { radius: 5, color: '#fff', weight: 1, fillColor: (i.confirms || 0) >= 2 ? '#ff5d73' : '#8f86b3', fillOpacity: .9, bubblingMouseEvents: false }).bindPopup(d).addTo(g); });
  }, [inc]);
  const key = pos[0].toFixed(2) + ',' + pos[1].toFixed(2);
  useEffect(() => {
    if (nav) return;
    const q = `[out:json][timeout:15];(node["amenity"="police"](around:3000,${pos[0]},${pos[1]});node["amenity"="hospital"](around:3000,${pos[0]},${pos[1]}););out 60;`;
    fetch('https://overpass-api.de/api/interpreter', { method: 'POST', body: 'data=' + encodeURIComponent(q) }).then(r => r.json()).then(j => {
      const all = (j.elements || []).map(e => ({ id: e.id, lat: e.lat, lon: e.lon, type: e.tags?.amenity === 'police' ? 'Police station' : 'Hospital', name: e.tags?.name || (e.tags?.amenity === 'police' ? 'Police station' : 'Hospital'), phone: e.tags?.phone || e.tags?.['contact:phone'], d: D(pos, [e.lat, e.lon]) })).sort((a, b) => a.d - b.d);
      setHelp([...all.filter(x => x.type === 'Police station').slice(0, 8), ...all.filter(x => x.type === 'Hospital').slice(0, 4)].sort((a, b) => a.d - b.d));
    }).catch(() => setHelp([]));
  }, [key]);
  useEffect(() => {
    const g = lay.current.help; g.clearLayers();
    if (!to) help.forEach(h => L.marker([h.lat, h.lon], { icon: L.divIcon({ className: '', html: `<div class="pin ${h.type === 'Hospital' ? 'hospital' : 'police'}">${h.type === 'Hospital' ? '+' : 'P'}</div>`, iconSize: [26, 26] }) }).bindPopup(`<b>${h.name}</b><br>${h.type} · ${km(h.d)}`).addTo(g));
  }, [help, to]);
  useEffect(() => {
    if (!to) { setRaw([]); setNav(false); return; }
    setBusy(true); setNav(false); setSel(null);
    const q = `${from.ll[1]},${from.ll[0]};${to.ll[1]},${to.ll[0]}?alternatives=true&overview=full&geometries=geojson&steps=true`;
    const ac = new AbortController(), tm = setTimeout(() => ac.abort(), 12000); setRouteErr(false);
    fetch(`https://routing.openstreetmap.de/routed-${mode}/route/v1/driving/${q}`, { signal: ac.signal }).then(r => r.json()).then(j => { setRaw(j.routes || []); setRouteErr(!(j.routes || []).length); }).catch(() => { setRaw([]); setRouteErr(true); }).finally(() => { clearTimeout(tm); setBusy(false); });
    return () => { clearTimeout(tm); ac.abort(); };
  }, [from, to, mode, tick]);
  const depMs = later ? +new Date(later) : now, hr = new Date(depMs).getHours(), night = hr >= 19 || hr < 6;
  const routes = useMemo(() => raw.map(x => analyse(x, inc, night)), [raw, inc, night]);
  const bestIdx = routes.reduce((a, x, k) => (x.redM < routes[a].redM - 1 || (Math.abs(x.redM - routes[a].redM) <= 1 && x.score > routes[a].score)) ? k : a, 0);
  const fastIdx = routes.reduce((a, x, k) => x.duration < routes[a].duration ? k : a, 0), cur = sel ?? bestIdx, r = routes[cur];
  useEffect(() => {
    const g = lay.current.routes; g.clearLayers();
    routes.forEach((x, k) => {
      if (k === cur) { L.polyline(x.geometry.coordinates.map(c => [c[1], c[0]]), { color: '#fff', weight: 12, opacity: .9, bubblingMouseEvents: false }).addTo(g); x.segs.forEach(s => L.polyline(s.pts, { color: LV[s.level], weight: 8, opacity: 1, lineCap: 'round', bubblingMouseEvents: false }).addTo(g)); }
      else L.polyline(x.geometry.coordinates.map(c => [c[1], c[0]]), { color: '#8f86b3', weight: 5, opacity: .6, dashArray: '6 8', bubblingMouseEvents: false }).on('click', () => setSel(k)).addTo(g);
    });
    lay.current.iso.eachLayer(l => l.bringToFront());
  }, [routes, cur]);
  useEffect(() => { if (raw.length) map.current.fitBounds(L.geoJSON(raw[0].geometry).getBounds(), { paddingTopLeft: [30, 110], paddingBottomRight: [30, 280] }); }, [raw]);
  const fkey = r ? `${Math.round(r.distance)}-${r.geometry.coordinates.length}` : '';
  useEffect(() => {
    if (!r) { setFac([]); setFacErr(false); return; }
    const cs = r.geometry.coordinates, step = Math.max(1, Math.floor(cs.length / 45)), pts = cs.filter((_, k) => k % step === 0).map(c => `${c[1].toFixed(5)},${c[0].toFixed(5)}`).join(','), a = `(around:120,${pts})`;
    const q = `[out:json][timeout:25];(node["amenity"~"^(hospital|clinic|pharmacy|police|restaurant|cafe|fast_food|bar|pub|fuel|bank|atm)$"]${a};node["shop"]${a};node["highway"="bus_stop"]${a};node["railway"~"^(station|subway_entrance|tram_stop)$"]${a};node["public_transport"~"^(platform|stop_position)$"]${a};);out 400;`;
    setFacBusy(true); setFacErr(false);
    fetch('https://overpass-api.de/api/interpreter', { method: 'POST', body: 'data=' + encodeURIComponent(q) }).then(x => x.json()).then(j => setFac((j.elements || []).map(classify))).catch(() => { setFac([]); setFacErr(true); }).finally(() => setFacBusy(false));
  }, [fkey]);
  const iso = useMemo(() => {
    if (!r || !fac.length) return [];
    const anchors = fac.filter(f => f.kind !== 'transit'), cs = r.geometry.coordinates, out = []; let gap = 0, start = 0;
    for (let k = 1; k < cs.length; k++) {
      gap += D([cs[k - 1][1], cs[k - 1][0]], [cs[k][1], cs[k][0]]);
      if (anchors.some(f => Math.abs(f.lat - cs[k][1]) < .0007 && Math.abs(f.lon - cs[k][0]) < .0009)) { if (gap > 300) out.push({ pts: cs.slice(start, k + 1).map(c => [c[1], c[0]]), len: gap }); gap = 0; start = k; }
    }
    if (gap > 300) out.push({ pts: cs.slice(start).map(c => [c[1], c[0]]), len: gap });
    return out;
  }, [r, fac]);
  useEffect(() => {
    const g = lay.current.fac; g.clearLayers();
    fac.filter(f => show[f.kind]).forEach(f => L.marker([f.lat, f.lon], { icon: L.divIcon({ className: '', html: `<div class="fp ${f.kind}">${{ help: '+', open: 'S', transit: 'T' }[f.kind]}</div>`, iconSize: [22, 22] }) }).bindPopup(`<b>${f.name}</b><br>${f.label}<br>${f.hours ? 'Hours: ' + f.hours : 'Opening hours unverified'}`).addTo(g));
  }, [fac, show]);
  useEffect(() => {
    const g = lay.current.iso; g.clearLayers();
    iso.forEach(x => { L.polyline(x.pts, { color: '#e879f9', weight: 14, opacity: .3, bubblingMouseEvents: false }).addTo(g); L.polyline(x.pts, { color: '#fff', weight: 3, dashArray: '2 8', bubblingMouseEvents: false }).bindPopup(`Isolated stretch: about ${km(x.len)} with no mapped open place`).addTo(g); });
  }, [iso]);
  const send = d => api('/sensor-data', { ...d, lat: pos[0], lng: pos[1] }).then(load);
  useEffect(() => {
    if (!nav || !r || dev.current) return;
    const off = Math.min(...r.geometry.coordinates.filter((_, k) => k % 3 === 0).map(c => D(pos, [c[1], c[0]])));
    if (off > 150) { dev.current = true; clearInterval(walk.current); send({ sos: true, accel: 0, sound: 0, reason: 'Left planned route' }); setToast('You left your route. Checking in…'); }
  }, [pos]);
  const simulate = () => { if (!r) return; const pts = r.geometry.coordinates.map(c => [c[1], c[0]]), step = Math.max(1, Math.floor(pts.length / 40)); let k = 0; clearInterval(walk.current); walk.current = setInterval(() => { k += step; if (k >= pts.length) { clearInterval(walk.current); setToast('Arrived safely. Contacts notified.'); return; } setPos(pts[k]); }, 700); };
  const endTrip = () => { clearInterval(walk.current); setNav(false); setPos(from.ll); };
  const share = () => { navigator.clipboard?.writeText(`I'm travelling ${from.name} to ${to.name}, arriving about ${arrive}. SafeGuard safety score ${r.score}.`); setToast('Trip shared with ' + (contacts.map(c => c.name).join(', ') || 'your contacts')); };
  const locate = () => {
    if (!navigator.geolocation) return setToast('This browser does not support location.');
    setToast('Finding your location…');
    navigator.geolocation.getCurrentPosition(
      p => { const ll = [p.coords.latitude, p.coords.longitude]; setPos(ll); setFrom({ name: 'Your location', ll }); map.current.setView(ll, 15); setToast('Location found, accuracy about ' + Math.round(p.coords.accuracy) + ' m'); },
      e => setToast(e.code === 1 ? 'Location is blocked. Click the lock icon next to the address bar, set Location to Allow, then reload.' : e.code === 2 ? 'Location unavailable. Turn on Windows Settings > Privacy > Location.' : 'Location timed out. Tap the ◎ button to try again.'),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
  };
  useEffect(() => { locate(); }, []);
  const nearest = t => { const h = help.find(x => x.type === t); h ? setTo({ name: h.name, ll: [h.lat, h.lon] }) : setToast('No ' + t.toLowerCase() + ' found within 3 km.'); };
  const arrive = r && new Date(depMs + r.duration * 1000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const soon = () => { const d = new Date(Date.now() + 36e5); d.setMinutes(0); return new Date(d - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 16); };
  const startTrip = () => { setNav(true); setSh(40); dev.current = false; setPos(from.ll); map.current.setView(from.ll, 17); };
  const nextStep = r && (() => { const st = r.legs[0].steps; let b = 0, bd = 1e9; st.forEach((x, k) => { const d = D(pos, [x.maneuver.location[1], x.maneuver.location[0]]); if (d < bd) { bd = d; b = k; } }); return st[Math.min(b + 1, st.length - 1)]; })();
  const pending = alerts.find(a => a.status === 'pending'), secs = pending ? Math.max(0, Math.ceil((new Date(pending.deadline) - now) / 1000)) : 0;
  const hold = on => { clearTimeout(holdT.current); if (on) holdT.current = setTimeout(() => send({ sos: true, accel: 0, sound: 0 }), 1200); };
  return (<div className="app">
    <header><div><h1>SafeGuard AI</h1><small className="tagline">Safer Routes. Smarter Journeys.</small></div><div className="hr"><span className={'chip' + (pending ? ' warn' : '')}>{pending ? 'Checking in' : (nav ? 'Trip monitored · ' : 'Protected · ') + net}</span><button className="ic" onClick={locate} aria-label="Use my location">◎</button><button className="ic" onClick={() => setTab('device')} aria-label="Settings and contacts">⚙</button></div></header>
    {toast && <div className="toast">{toast}</div>}
    <main>
      <div ref={wrap} style={{ '--sh': sh + '%' }} className={'mapwrap' + (tab === 'map' ? '' : ' hide')}>
        <div ref={mapEl} className="map" />
        {!nav && sh <= 60 && <div className="top">
          {to && !edit ? <button className="card summary" onClick={() => setEdit(true)}><span>{from.name} <i>to</i> {to.name}</span><b>Edit</b></button> :
            <div className="card tight">
              <Search value={from.name} bias={pos} placeholder="Pickup point" icon="●" onPick={p => { setFrom(p); if (to) setEdit(false); }} />
              <Search value={to?.name || ''} bias={pos} placeholder="Where to?" icon="⚑" onPick={p => { setTo(p); setEdit(false); }} />
              {to && <button className="swap" aria-label="Swap pickup and destination" onClick={() => { setFrom(to); setTo(from); }}>⇅</button>}
            </div>}
        </div>}
        {nav && r && nextStep && <div className="navbar"><b>{say(nextStep)}</b><small>in {km(D(pos, [nextStep.maneuver.location[1], nextStep.maneuver.location[0]]))}</small></div>}
        {to && !nav && sh <= 60 && <button className="layb" onClick={() => setLayersOpen(v => !v)}>Layers</button>}
        {layersOpen && to && !nav && sh <= 60 && <div className="layp">{[['help', 'Help points'], ['open', 'Shops'], ['transit', 'Transport']].map(([k, n]) => <button key={k} className={show[k] ? 'on' : ''} onClick={() => setShow(v => ({ ...v, [k]: !v[k] }))}>{n}</button>)}</div>}
        {sh <= 60 && <button className="loc" onClick={locate} aria-label="Use my location">◎</button>}
        <button className="sos" style={sh > 60 ? { bottom: 'auto', top: 10 } : undefined} onPointerDown={() => hold(true)} onPointerUp={() => hold(false)} onPointerLeave={() => hold(false)}>Hold for SOS</button>
        <div className="sheet" style={{ height: sh + '%', maxHeight: 'none' }}>
          <div className="grab" role="separator" aria-label="Drag to resize the panel" onPointerDown={dragStart} />
          {!to && <p>Search a place above, or tap the map to drop a pin. Routes are scored using community reports and mapped places.</p>}
          {to && !nav && <div className="seg">{Object.entries(MODES).map(([k, n]) => <button key={k} className={mode === k ? 'on' : ''} onClick={() => setMode(k)}>{n}</button>)}</div>}
          {to && busy && <p>Finding routes…</p>}
          {to && !busy && !routes.length && <><p>{routeErr ? 'The route server is slow or busy.' : 'No ' + MODES[mode].toLowerCase() + ' route found. Try another mode or place.'}</p><button className="b alt" onClick={() => setTick(v => v + 1)}>Try again</button></>}
          {to && !nav && routes.map((x, k) => <button key={k} className={'rc' + (k === cur ? ' on' : '')} onClick={() => setSel(k)}>
            <div><span className="eta">{mins(x.duration)}</span>{k === bestIdx && <span className="tag safe">Safest</span>}{k === fastIdx && <span className="tag fast">Fastest</span>}<br /><small>{km(x.distance)} · {x.n} reports · {x.redM > 0 ? km(x.redM) + ' high risk' : 'no red zones'}</small></div>
            <span className="score" style={{ background: tone(x.score) }}>{x.score}</span></button>)}
          {to && !nav && r && r.redM > 0 && <div className="warnbox"><span>Red zone: {km(r.redM)} of this route is high risk{night ? ' at night' : ''}.</span>{cur !== bestIdx && <button className="b red" onClick={() => setSel(bestIdx)}>Avoid red zones</button>}</div>}
          {to && !nav && r && <button className="b" onClick={startTrip}>Start trip · arrive {arrive}</button>}
          {to && !nav && r && !open && <small>Drag the bar up for options and route details, or down to hide this panel.</small>}
          {to && !nav && open && <>
            <div className="seg"><button className={!later ? 'on' : ''} onClick={() => setLater('')}>Leave now</button><button className={later ? 'on' : ''} onClick={() => setLater(later || soon())}>Leave later</button></div>
            {later && <input type="datetime-local" value={later} onChange={e => setLater(e.target.value)} />}
            {night && <small>Night mode is on for departures between 7 pm and 6 am, so quiet and risky stretches count more.</small>}
            {routes.length > 0 && <div className="legend"><span style={{ '--c': LV[0] }}>Safer</span><span style={{ '--c': LV[1] }}>Caution</span><span style={{ '--c': LV[2] }}>Avoid</span><span style={{ '--c': '#e879f9' }}>Isolated</span></div>}
            {r && <div className="detail"><b>Route analysis</b>
              <div className="kv"><span>Travel time</span><b>{mins(r.duration)}</b><span>Distance</span><b>{km(r.distance)}</b><span>Community-risk stretch</span><b>{r.redM > 0 ? km(r.redM) : 'none'}</b><span>Isolated stretches</span><b>{facBusy ? 'checking…' : facErr || !fac.length ? 'unknown' : iso.length ? iso.length + ' · ' + km(iso.reduce((a, x) => a + x.len, 0)) : 'none found'}</b></div>
              <small>{facBusy ? 'Checking places along this route…' : facErr ? 'Could not load nearby places. Isolation is unknown, not safe.' : !fac.length ? 'No mapped places found along this route, so isolation cannot be assessed.' : `Along the route: ${fac.filter(f => f.kind === 'help').length} help points, ${fac.filter(f => f.kind === 'open').length} shops and eateries, ${fac.filter(f => f.kind === 'transit').length} transport stops. Opening hours are often missing on OpenStreetMap, so some places may be closed at night.`}</small>
              <small>Indicative information from OpenStreetMap and community reports. It is not a guarantee of personal safety.</small></div>}
            <button className="b alt" onClick={() => setTo(null)}>Clear route</button></>}
          {nav && r && <><div className="row"><b>{mins(r.duration)} · {km(r.distance)} · arrive {arrive}</b><span className="score" style={{ background: tone(r.score) }}>{r.score}</span></div>
            <small>Monitoring is on. Contacts are alerted if distress is detected or you leave this route.</small>
            <div className="seg"><button onClick={share}>Share trip</button><button onClick={simulate}>Simulate walk</button><button onClick={() => setPos(p => [p[0] + .004, p[1]])}>Go off route</button></div>
            <ol className="steps">{r.legs[0].steps.map((x, k) => <li key={k}>{say(x)} <small>{km(x.distance)}</small></li>)}</ol>
            <button className="b alt" onClick={endTrip}>End trip</button></>}
        </div>
      </div>
      {tab === 'help' && <div className="pad"><div className="card"><h2>Call for help</h2><div className="lines">{LINES.map(([n, t]) => <a key={n} className="line" href={'tel:' + n}><b>{n}</b><small>{t}</small></a>)}</div></div>
        <div className="seg"><button onClick={() => { nearest('Police station'); setTab('map'); }}>Route to nearest police</button><button onClick={() => { nearest('Hospital'); setTab('map'); }}>Route to nearest hospital</button></div>
        <h2>Within 3 km of you</h2>{!help.length && <p>Looking up police stations and hospitals nearby…</p>}
        {help.map(h => <div className="card row" key={h.id}><div><b>{h.name}</b><br /><small>{h.type} · {km(h.d)}</small></div><div className="acts">{h.phone && <a href={'tel:' + h.phone}>Call</a>}<button onClick={() => { setTo({ name: h.name, ll: [h.lat, h.lon] }); setTab('map'); }}>Route</button></div></div>)}</div>}
      {tab === 'report' && <Report me={pos} done={(row, place) => { load(); setTab('map'); setTimeout(() => map.current.setView([row.lat, row.lng], 17), 150); setToast(`Reported: ${row.type} near ${place}`); }} />}
      {tab === 'alerts' && <div className="pad">{!alerts.length && <p>No alerts yet. Trigger one from the Device tab.</p>}{alerts.map(a => <div className="card" key={a.id}><div className="row"><b className={'s-' + a.status}>{a.status}</b><small>{new Date(a.created_at).toLocaleTimeString()}</small></div><p>{a.reason} · confidence {Math.round(a.score * 100)}%</p>{a.notified && <small>Notified: {a.notified.join(', ')} with live location</small>}</div>)}</div>}
      {tab === 'device' && <div className="pad">
        <div className="card"><h2>Wearable simulator</h2><p>Sends the same readings the ESP32 will (accelerometer, mic, GPS).</p></div>
        {[['Normal walk', { accel: 1.1, sound: 45 }], ['Sudden fall', { accel: 3.4, sound: 50 }], ['Scream', { accel: .8, sound: 92 }], ['Struggle + scream', { accel: 3.8, sound: 95 }]].map(([n, d]) => <button key={n} className="b alt" onClick={() => send(d)}>{n}</button>)}
        <div className="card"><h2>Connectivity</h2><button className="b alt" onClick={() => setNet(n => n === 'WiFi' ? 'GSM fallback' : 'WiFi')}>Using {net}. Tap to switch</button></div>
        <Contacts contacts={contacts} reload={load} /></div>}
    </main>
    {pending && <div className="over"><h2>Possible emergency detected</h2><div className="ring">{secs}</div><p>Alerting your contacts with your location unless you cancel.</p><button className="b" onClick={() => api(`/alerts/${pending.id}/cancel`, {}).then(load)}>I'm OK, cancel</button></div>}
    <nav>{[['map', 'Map'], ['help', 'Help'], ['report', 'Report'], ['alerts', 'Alerts'], ['device', 'Device']].map(([k, n]) => <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{n}</button>)}</nav>
  </div>);
}
function Search({ value, placeholder, onPick, icon, bias }) {
  const [q, setQ] = useState(''), [s, setS] = useState([]), [open, setOpen] = useState(false);
  useEffect(() => {
    if (q.length < 3) { setS([]); return; }
    const vb = `${bias[1] - .5},${bias[0] + .5},${bias[1] + .5},${bias[0] - .5}`;
    const t = setTimeout(() => fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=5&countrycodes=in&viewbox=${vb}&q=${encodeURIComponent(q)}`).then(r => r.json()).then(setS).catch(() => setS([])), 450);
    return () => clearTimeout(t);
  }, [q]);
  return <div className="sb"><i>{icon}</i><input value={open ? q : value} placeholder={placeholder} onFocus={() => { setOpen(true); setQ(''); }} onChange={e => setQ(e.target.value)} onBlur={() => setTimeout(() => setOpen(false), 250)} />
    {open && s.length > 0 && <div className="sugs">{s.map(x => <button key={x.place_id} onPointerDown={() => { onPick({ name: x.display_name.split(',').slice(0, 2).join(','), ll: [+x.lat, +x.lon] }); setOpen(false); setS([]); }}>{x.display_name}</button>)}</div>}</div>;
}
function Report({ me, done }) {
  const [type, setType] = useState('Harassment'), [anon, setAnon] = useState(true), [err, setErr] = useState(''), [pin, setPin] = useState(me), [place, setPlace] = useState('Finding place…');
  const el = useRef(), mk = useRef();
  useEffect(() => {
    const m = L.map(el.current, { zoomControl: false }).setView(me, 17);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap contributors' }).addTo(m);
    mk.current = L.marker(me, { draggable: true }).addTo(m);
    mk.current.on('dragend', () => { const p = mk.current.getLatLng(); setPin([p.lat, p.lng]); });
    m.on('click', e => { mk.current.setLatLng(e.latlng); setPin([e.latlng.lat, e.latlng.lng]); });
    return () => m.remove();
  }, []);
  useEffect(() => {
    setPlace('Finding place…');
    const t = setTimeout(() => fetch(`https://nominatim.openstreetmap.org/reverse?format=json&zoom=18&lat=${pin[0]}&lon=${pin[1]}`).then(r => r.json()).then(j => setPlace((j.display_name || 'Unnamed place').split(',').slice(0, 3).join(','))).catch(() => setPlace('Place name unavailable')), 500);
    return () => clearTimeout(t);
  }, [pin]);
  const dist = Math.round(D(pin, me));
  return <div className="pad"><div className="card"><h2>Report an incident</h2><p>Tap the map or drag the pin to the exact spot. Reports must be within 200 m of your current location, are limited to 3 a day, and count fully once 2 other people confirm them.</p></div>
    <div ref={el} className="rmap" />
    <div className="card"><small>Reporting at</small><br /><b>{place}</b><br /><small style={{ color: dist > 200 ? 'var(--danger)' : 'var(--safe)' }}>{dist} m from you{dist > 200 ? ' (too far, move the pin closer)' : ''}</small></div>
    <select value={type} onChange={e => setType(e.target.value)}>{['Harassment', 'Poor lighting', 'Theft', 'Stalking', 'Unsafe crowd'].map(t => <option key={t}>{t}</option>)}</select>
    <label><input type="checkbox" style={{ width: 'auto' }} checked={anon} onChange={e => setAnon(e.target.checked)} /> Report anonymously (location rounded to about 100 m)</label>
    {err && <div className="warnbox">{err}</div>}
    <button className="b" disabled={dist > 200} onClick={() => api('/incidents', { type, lat: pin[0], lng: pin[1], anonymous: anon, device, userLat: me[0], userLng: me[1] }).then(x => x.error ? setErr(x.error) : done(x, place))}>Submit report</button></div>;
}
function Contacts({ contacts, reload }) {
  const [n, setN] = useState(''), [p, setP] = useState('');
  return <div className="card"><h2>Emergency contacts</h2>{contacts.map(c => <p key={c.id}>{c.name} · {c.phone}</p>)}
    <div style={{ display: 'grid', gap: 8, marginTop: 8 }}><input placeholder="Name" value={n} onChange={e => setN(e.target.value)} /><input placeholder="Phone" value={p} onChange={e => setP(e.target.value)} />
      <button className="b" onClick={() => n && p && api('/contacts', { name: n, phone: p }).then(() => { setN(''); setP(''); reload(); })}>Add contact</button></div></div>;
}