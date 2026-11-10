# kampala-last-mile-map

Static GitHub Pages site for an interactive map of last-mile connectivity and fixed-interval electric feeder buses in Greater Kampala. Live at https://gavacharles.github.io/kampala-last-mile-map/

The content is a research prototype built from open data; routes, costs and demand are modelled, not planned services.

## Contents

| Path | What it is |
|---|---|
| `index.html` | The map page |
| `kiira/` | Kiira EV last-mile model sub-site: page data (`data.js`), animations and stills (`img/`), and downloads (`downloads/kiira_gis_layers.zip`, `downloads/kiira_last_mile_model.xlsx`) |
| `charts/` | Chart images used on the page |
| `closeups/`, `bus_closeups/` | Close-up images for individual zones and routes (named by ID, e.g. `KLA-007.jpg`) |
| `.nojekyll` | Serve files as they are on GitHub Pages |

There is no build step in this repository. To view locally, serve the folder (`python -m http.server`) and open http://localhost:8000.

## Data sources and attribution

OpenStreetMap contributors (ODbL); Kampala route file by Transport for Cairo, via Digital Transport for Africa (2019/20); WorldPop 2020 (CC BY 4.0), scaled to the 2024 census; GHSL R2023A; Copernicus DEM; geoBoundaries; Meta Relative Wealth Index; Esri and partners for imagery and basemaps.
