#!/usr/bin/env bash
# Download a Geofabrik extract and pre-process it for OSRM car + foot profiles.
# Usage: ./infra/prepare-osrm.sh south-africa   (any Geofabrik Africa region slug)
set -euo pipefail
REGION="${1:-south-africa}"
DIR="$(cd "$(dirname "$0")" && pwd)/osrm"
IMG=ghcr.io/project-osrm/osrm-backend:latest
mkdir -p "$DIR/car" "$DIR/foot"
PBF="$DIR/$REGION-latest.osm.pbf"
[ -f "$PBF" ] || curl -fL -o "$PBF" "https://download.geofabrik.de/africa/$REGION-latest.osm.pbf"
for P in car foot; do
  cp "$PBF" "$DIR/$P/region.osm.pbf"
  docker run --rm -v "$DIR/$P:/data" "$IMG" osrm-extract -p "/opt/$P.lua" /data/region.osm.pbf
  docker run --rm -v "$DIR/$P:/data" "$IMG" osrm-partition /data/region.osrm
  docker run --rm -v "$DIR/$P:/data" "$IMG" osrm-customize /data/region.osrm
done
echo "OSRM ready. In the app settings set: drive → http://<host>:5000 (profile 'driving'), walk → http://<host>:5001 (profile 'driving')."
