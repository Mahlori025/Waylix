import { memo, useMemo } from 'react';
import { GeoJSONSource, Layer } from '@maplibre/maplibre-react-native';
import { taxonomy } from '../services/waylix';
import type { DisplayHazard } from '../hooks/useHazards';

const M_PER_PX_Z0 = 156543.03392; // Web-Mercator metres per pixel at zoom 0 on the equator

/**
 * Hazards as map layers: zones are translucent discs drawn at their true
 * ground radius at every zoom, point hazards are coloured dots, labels appear
 * when zoomed in. Unverified/pending hazards render faded.
 */
function HazardLayerImpl({ hazards, onSelect }: { hazards: DisplayHazard[]; onSelect: (id: string) => void }) {
  const data = useMemo<GeoJSON.FeatureCollection>(() => {
    const features: GeoJSON.Feature[] = hazards.map((h) => {
      const def = taxonomy.get(h.type);
      const r0 = h.radiusM / (M_PER_PX_Z0 * Math.cos((h.position[1] * Math.PI) / 180));
      return {
        type: 'Feature',
        id: h.id,
        geometry: { type: 'Point', coordinates: h.position },
        properties: {
          id: h.id,
          kind: def?.kind ?? 'point',
          color: def?.color ?? '#E8590C',
          label: def?.label ?? h.type,
          severity: h.severity,
          opacity: h.pending ? 0.45 : h.status === 'candidate' ? 0.55 : 1,
          verified: h.status === 'verified' ? 1 : 0,
          r0,
          r22: r0 * 4194304,
        },
      };
    });
    return { type: 'FeatureCollection', features };
  }, [hazards]);

  return (
    <GeoJSONSource
      id="hazards"
      data={data}
      hitbox={{ top: 12, right: 12, bottom: 12, left: 12 }}
      onPress={(e) => {
        const id = e.nativeEvent.features[0]?.properties?.id;
        if (typeof id === 'string') onSelect(id);
      }}
    >
      <Layer
        id="hazard-zones"
        type="circle"
        filter={['==', ['get', 'kind'], 'zone']}
        paint={{
          'circle-color': ['get', 'color'],
          'circle-opacity': ['*', 0.18, ['get', 'opacity']],
          'circle-stroke-color': ['get', 'color'],
          'circle-stroke-width': 1.5,
          'circle-stroke-opacity': ['*', 0.6, ['get', 'opacity']],
          'circle-radius': ['interpolate', ['exponential', 2], ['zoom'], 0, ['get', 'r0'], 22, ['get', 'r22']],
        }}
      />
      <Layer
        id="hazard-points"
        type="circle"
        filter={['==', ['get', 'kind'], 'point']}
        paint={{
          'circle-color': ['get', 'color'],
          'circle-opacity': ['get', 'opacity'],
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, ['+', 2, ['get', 'severity']], 17, ['+', 6, ['*', 2, ['get', 'severity']]]],
          'circle-stroke-color': '#FFFFFF',
          'circle-stroke-width': ['case', ['==', ['get', 'verified'], 1], 3, 1.5],
        }}
      />
      <Layer
        id="hazard-labels"
        type="symbol"
        minzoom={15}
        layout={{
          'text-field': ['get', 'label'],
          'text-font': ['Noto Sans Regular'],
          'text-size': 12,
          'text-offset': [0, 1.4],
          'text-anchor': 'top',
          'text-optional': true,
        }}
        paint={{ 'text-color': '#1F2937', 'text-halo-color': '#FFFFFF', 'text-halo-width': 1.5 }}
      />
    </GeoJSONSource>
  );
}

export const HazardLayer = memo(HazardLayerImpl);
