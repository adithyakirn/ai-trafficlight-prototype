# Bathery 3D Traffic Map

A mobile-first planning website for an adaptive traffic signal network in Sulthan Bathery, Wayanad, Kerala. The goal is to show where cameras could observe vehicle movements and where signals might work together, then use field measurements to decide what to pilot.

## What we discussed

The original idea was to deploy AI cameras across Bathery to observe traffic and vehicle movements, then coordinate traffic lights using what the cameras measure. New York’s Midtown in Motion and Singapore’s GLIDE were reference points for coordinating signals across a network, combining sensor types, and retaining operator oversight. The immediate deliverable became a Three.js website showing Bathery’s mapped roads, proposed cameras and candidate traffic lights. Town-wide coverage remains a longer-term goal.

We used OpenStreetMap road geometry to identify a roughly 3.4 km mapped connection from Beenachi to Chungam. The Assumption–Chungam portion is about 1.1 km. These are approximate distances derived from map geometry, rather than travel-time or congestion measurements. Parking, bus boarding and pedestrian crossings were identified as factors to measure because signal timing cannot restore capacity lost to blocked road space.

## What is available today

The map covers the town centre and nearby approaches. It has 27 illustrative camera views across nine survey locations, including six candidate signal sites. Road lines and building footprints come from OpenStreetMap. The terrain is flat, building heights are schematic, and camera positions and viewing sectors require field verification. The website has no live traffic feed or control connection.

| Survey location | Camera views | Candidate signal | What to measure |
| --- | ---: | --- | --- |
| Beenachi Junction | 3 | Yes | West approach arrivals, turns and queue growth |
| Assumption West Junction (working name) | 3 | No | NH766 arrivals toward Assumption and approach queues |
| Assumption Junction | 4 | Yes | Turns and pedestrian demand near the school and hospital |
| Central NH766 junction | 4 | Yes | Turns near the Town Bus Stand and interaction between adjoining roads. Verify the local junction name |
| Gandhi Junction | 3 | Yes | Chulliyode road turns and current one-way movements |
| Chungam Junction | 3 | Yes | NH766 turns, downstream queues and bus interactions |
| Kottakunnu Junction | 3 | Yes | Arrivals and queues on the Pulpally approach |
| Town Bus Stand | 2 | No | Bus entry, exit, dwell time and crossings |
| Chungam Bus Stand | 2 | No | Terminal access queues and curb obstruction |

Drag to pan, pinch to zoom, and rotate with two fingers. On desktop, right-drag rotates the map. Search for a location or choose one from **Locations**, then tap a camera to inspect its proposed viewing direction. **Map layers** switches cameras, signals, viewing sectors and buildings on or off. **The plan** exports the proposed cameras and signal sites as GeoJSON in WGS84 longitude/latitude order.

[Open the private website](https://bathery-traffic-3d.keenabode1.chatgpt.site)

Each of the seven junction locations has a proposed roadside view on every mapped approach, including the local street that joins NH766 immediately beside Assumption Junction. The two bus terminals retain their access views. C24 is a proposed roadside view between Ambalavayal Road and Assumption Junction. It faces west along NH766 to observe approaching eastbound traffic. The mapped road distance to the Assumption candidate signal is about 290 m, or roughly 26 seconds at a constant 40 km/h. Verify the mounting position, sight lines and actual travel times in the field.

## Run locally in Antigravity

1. Extract the project into your Freelance folder.
2. In Antigravity, choose **File → Open Folder**, then select `Freelance/Bathery-3D-Map`.
3. Open the integrated terminal in the project root and run `npm start`. This requires Node/npm and Python 3.
4. Open [http://127.0.0.1:8080/](http://127.0.0.1:8080/). With Python alone, run `python3 -m http.server 8080 --bind 127.0.0.1 --directory dist`.

No dependency installation or build step is required. Three.js and the map data are bundled. The app needs an HTTP server to load its modules and map data.

| File | Purpose |
| --- | --- |
| `dist/index.html` and `dist/style.css` | Map interface and phone layout |
| `dist/app.js` | Three.js scene, layers, markers, search, navigation and export |
| `dist/software-renderer.js` | Canvas fallback when WebGL is unavailable |
| `dist/map-data.json` | Roads, buildings, green areas, survey sites and camera positions |
| `dist/vendor/` | Bundled Three.js, controls, geometry utilities and license |
| `AGENTS.md` | Working context and instructions for coding agents |

## From concept map to pilot

1. **Obtain existing records.** Request NATPAC’s Bathery traffic study and count sheets. Coordinate with the municipality, Traffic Unit and relevant road authorities to verify current junction layouts, restrictions, assets and responsibilities.
2. **Collect a baseline.** Start with 7–14 days covering weekdays and weekends. Add holiday and wet-weather samples. Record 15-minute turning totals by vehicle class, queue lengths, pedestrian waits, corridor travel times, bus dwell and roadside loading. Validate camera detections against manual counts.
3. **Survey camera coverage.** Check sight lines around buses, bends and vegetation, along with visibility in rain and darkness. Use junction views for stop lines, turns and crossings. Place additional views along road approaches where they can capture arriving traffic and queue tails. Choose each mounting point based on sight lines and the measurement it needs to support. Add supplementary detection where cameras cannot reliably see.
4. **Choose a connected pilot.** Select three or four junctions once measurements establish what is needed. Compare tuned fixed or actuated timing with adaptive timing in simulation and observation mode before any live trial.
5. **Evaluate before expanding.** Compare corridor travel time, queue lengths, pedestrian wait, throughput and fault recovery under comparable conditions. Use those results to decide where to expand toward town-wide coverage.

The proposed operational architecture uses local processing to produce aggregate counts, turns and queue estimates. A corridor coordinator can suggest timing adjustments based on demand and available downstream space. Approved local controllers enforce phase conflicts, pedestrian clearance and fallback timings, with operator override. The map is a planning tool for that architecture.

## Sources

- [OpenStreetMap base map](https://www.openstreetmap.org/#map=15/11.6635/76.2595) · [© OpenStreetMap contributors, ODbL](https://www.openstreetmap.org/copyright)
- [NATPAC consultancy studies](https://natpac.kerala.gov.in/consultancy-projects/) · [Sulthan Bathery Traffic Unit](https://wayanad.gov.in/en/public-utility/traffic-unit-sulthan-bathery/)
- [New York Midtown in Motion audit](https://www.osc.ny.gov/state-agencies/audits/2024/04/11/oversight-selected-aspects-traffic-controls-follow) · [Singapore adaptive signal coordination](https://www.lta.gov.sg/content/ltagov/en/newsroom/2026/3/media-replies/traffic-data-used-to-optimise-network-flow-while-prioritising-sa.html)
