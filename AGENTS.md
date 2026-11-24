# Working on the Bathery 3D Traffic Map

## Project intent

This repository is a mobile-first Three.js planning tool for Sulthan Bathery. It should help someone find a junction, inspect where proposed cameras and signals could go, and export locations for field review. The longer-term project is coordinated, adaptive traffic management across Bathery. Read README.md for project history, exact locations and the proposed pilot sequence.

## Read before making changes

- `dist/` is both the editable web source and the static hosting output. There is no build step. Start with `dist/app.js`, `dist/map-data.json`, then the relevant HTML/CSS or fallback renderer.
- The current baseline is nine survey locations, six candidate signal sites and 27 illustrative camera views. Update related counts, markers, location details and GeoJSON export when changing the dataset. Keep IDs stable where possible.
- Map geometry is sourced from OpenStreetMap. Keep attribution visible and retain the distinction between mapped geometry, schematic buildings, and proposed equipment. Use WGS84 longitude/latitude for exported coordinates and preserve the local projection used for rendering.
- Survey data has not been obtained. Keep measured, estimated and proposed values explicitly labelled. A candidate signal site is a location to assess. A viewing sector shows an illustrative direction. Keep bus-stand centroids distinct from surveyed camera or pole positions.

## Implementation priorities

- Preserve the current map controls, location search, camera inspection, layer toggles and export. Keep touch controls easy to reach on small screens and location selection available without relying on gestures or color alone.
- Support the WebGL renderer and the Canvas fallback. When changing map rendering or overlays, check both paths. Keep geometry and render work modest for phones.
- Prefer aggregated counts and short-lived local tracking for any future analytics prototype. Keep simulated and measured data separate. A future live integration needs a surveyed baseline and approval from the road authority. Physical signal controllers own conflict prevention, clearance and fallback behavior.
- Default the next engineering work to field-survey and data ingestion needs before adding signal timing. Preserve existing functionality unless the user asks to change it.

## Verify changes

Run `npm start` from the project root and open `http://127.0.0.1:8080/`. Check a narrow phone layout and desktop. Search for Chungam, inspect a camera, toggle cameras/signals/sectors, switch views, and verify GeoJSON when touched. Use `node --check dist/app.js` and `node --check dist/software-renderer.js` for JavaScript edits. When changing data, verify all camera parent IDs resolve and the signal and camera totals match the UI and export. Record which renderer and browser were exercised.
