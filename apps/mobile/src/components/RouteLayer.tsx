import { memo, useMemo } from 'react';
import { GeoJSONSource, Layer } from '@maplibre/maplibre-react-native';
import type { LngLat } from '@waylix/engine';
import { colors } from '../theme';

/** Selected route on top, alternatives in grey underneath. */
function RouteLayerImpl({ routes, selected, walking }: { routes: LngLat[][]; selected: number; walking: boolean }) {
  const data = useMemo<GeoJSON.FeatureCollection>(
    () => ({
      type: 'FeatureCollection',
      features: routes
        .map((coords, i) => ({
          type: 'Feature' as const,
          geometry: { type: 'LineString' as const, coordinates: coords },
          properties: { selected: i === selected ? 1 : 0 },
        }))
        .sort((a, b) => a.properties.selected - b.properties.selected),
    }),
    [routes, selected],
  );
  if (!routes.length) return null;
  return (
    <GeoJSONSource id="route" data={data} lineMetrics>
      <Layer
        id="route-casing"
        type="line"
        layout={{ 'line-join': 'round', 'line-cap': 'round' }}
        paint={{
          'line-color': ['case', ['==', ['get', 'selected'], 1], colors.brandDark, '#64748B'],
          'line-width': ['interpolate', ['linear'], ['zoom'], 10, 5, 18, 14],
          'line-opacity': ['case', ['==', ['get', 'selected'], 1], 1, 0.5],
        }}
      />
      <Layer
        id="route-line"
        type="line"
        layout={{ 'line-join': 'round', 'line-cap': 'round' }}
        paint={{
          'line-color': ['case', ['==', ['get', 'selected'], 1], colors.route, colors.routeAlt],
          'line-width': ['interpolate', ['linear'], ['zoom'], 10, 3, 18, 10],
          ...(walking ? { 'line-dasharray': [0.2, 1.6] } : {}),
        }}
      />
    </GeoJSONSource>
  );
}

export const RouteLayer = memo(RouteLayerImpl);
