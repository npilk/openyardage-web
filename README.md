# OpenYardage

Generate printable golf yardage books directly in your browser using course data from [OpenStreetMap](https://www.openstreetmap.org/). This is a Javascript port of [Hacker Yardage](https://github.com/npilk/hacker-yardage).

## Features

- Search for any golf course by name and auto-fit a bounding box, or draw one manually
- Customizable colors for fairways, greens, water, sand, trees, and more
- Distance annotations: carry distances, feature-to-green distances, 50-yard arc rings
- Green close-up inset with 3-yard grid on every hole page
- Exports a print-ready PDF
- Works with any course that has `golf=hole` ways tagged in OpenStreetMap

## Usage

1. **Select Course** — Search by name or draw a rectangle on the map around the course
2. **Generate** — Adjust colors, units (yards/meters), and options
3. **Review and Export** — Tweak individual holes as needed, then export to PDF

## Running Locally

The app uses ES modules, so it must be served over HTTP (not opened as `file://`):

```bash
cd openyardage-web
python3 -m http.server 8080
# then open http://localhost:8080
```

Any static file server also works: `npx serve`, VS Code Live Server, Caddy, nginx, etc.


## OSM Data Quality

Output quality depends on how well the course is mapped in OpenStreetMap.
A well-mapped course will have:
- `golf=hole` ways for each hole (tee → green node order)
- `golf=fairway`, `golf=green`, `golf=bunker`, `golf=tee` polygons
- `natural=water`, `natural=wood` / `landuse=forest` for hazards

If the course you want isn't mapped, you can sign up yourself at [openstreetmap.org](https://www.openstreetmap.org/) and map it directly &mdash; see [this guide](https://github.com/npilk/hacker-yardage/blob/main/docs/howtomap.md) for more information.

## Attribution

Map data © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright) (ODbL)
