# SafeGuard AI: women's night-safety navigation (Team VorteXx)
Software prototype. Hardware is simulated by the Device tab, which sends the same readings an ESP32 will POST to /sensor-data.

## Run
1. Backend: `cd backend`, `cp .env.example .env` (Windows: copy), `npm install`, `npm start` (port 4000)
2. Frontend: `cd frontend`, `npm install`, `npm run dev`, then open the printed link and allow location.
No API keys needed. Optional: GEMINI_API_KEY for AI classification, SUPABASE_URL and SUPABASE_KEY for persistence (run supabase/schema.sql).

## Features
- Dark Leaflet map (OpenStreetMap data, CARTO tiles), search, swap, Walk/Drive/Bike, Leave now or tonight
- OSRM alternative routes coloured by community-report risk; "Avoid red zones"
- Nearby places along the chosen route from Overpass: help points, shops and eateries, transport stops (toggle each)
- Isolated stretches: parts of the route with 300 m or more and no mapped open place, drawn as a dashed purple highlight
- Route analysis: time, distance, risk stretch, isolation, place counts
- Wearable alert flow: classify, 10 s cancel window, notify contacts; trip sharing and route-deviation alert
- Help tab: 112, 181, 1091 and police and hospitals within 3 km

## Report trust
New reports are "unconfirmed" and carry 30% weight until 2 other devices confirm them. Reports must be within 200 m of the reporter's location, each device gets 3 reports a day, and nobody can confirm their own report or confirm twice. These checks are tracked per device in server memory, so they reset when the backend restarts and are not real accounts.

## Data limits
OpenStreetMap coverage and opening hours are incomplete in India. Missing data is shown as unknown or unverified, never as safe. Community incidents are sample data. Information is indicative and not a guarantee of personal safety. The public Overpass and OSRM servers are for light use.
