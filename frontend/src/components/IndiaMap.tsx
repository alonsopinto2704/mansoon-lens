import { useEffect, useMemo, useRef } from 'react';
import { AttributionControl, GeoJSON, MapContainer, Pane, useMap, ZoomControl } from 'react-leaflet';
import { Maximize2 } from 'lucide-react';
import L, { type Layer, type LeafletMouseEvent, type Path } from 'leaflet';
import { useQuery } from '@tanstack/react-query';
import 'leaflet/dist/leaflet.css';
import { escapeHtml, get } from '../lib';
import { useForecastStore } from '../store';
import { ErrorState, Skeleton } from './ui';

type Props<T extends { district_id: string }> = {
  items: T[];
  color: (item: T) => string;
  tooltip: (item: T) => string;
  selected?: string | null;
  onSelect?: (id: string) => void;
  height?: number | string;
  /** Hide zoom and reset controls (small preview maps). */
  compact?: boolean;
};

type Feature = { type: 'Feature'; properties: { district_id?: string; district?: string; state: string }; geometry: object };
type FeatureCollection = { type: 'FeatureCollection'; features: Feature[] };

const useGeo = (name: 'districts' | 'states') =>
  useQuery({ queryKey: ['geo', name], queryFn: () => get<FeatureCollection>(`/geo/${name}`), staleTime: Infinity });

const INDIA: L.LatLngBoundsExpression = [[6.5, 68], [37.2, 97.5]];

function FitIndia({ compact }: { compact: boolean }) {
  const map = useMap();
  useEffect(() => {
    const fit = () => map.fitBounds(INDIA, { padding: [8, 8] });
    fit();
    const observer = new ResizeObserver(() => { map.invalidateSize(); fit(); });
    observer.observe(map.getContainer());
    return () => observer.disconnect();
  }, [map]);
  if (compact) return null;
  return (
    <button type="button" className="map-reset" title="Fit India" aria-label="Reset map view to all of India"
      onClick={(event) => { event.stopPropagation(); map.fitBounds(INDIA, { padding: [8, 8] }); }}>
      <Maximize2 size={15} aria-hidden />
    </button>
  );
}

/** District choropleth over official-outline district polygons. No tile server: works offline. */
export function IndiaMap<T extends { district_id: string }>({ items, color, tooltip, selected, onSelect, height = '100%', compact = false }: Props<T>) {
  const districts = useGeo('districts');
  const live = useForecastStore((s) => s.source === 'live');
  const states = useGeo('states');
  const byId = useMemo(() => new Map(items.map((i) => [i.district_id, i])), [items]);
  const layers = useRef(new Map<string, { path: Path; name?: string }>());
  // Keep latest callbacks without re-creating the GeoJSON layer (800 polygons).
  const latest = useRef({ byId, color, tooltip, onSelect, selected });
  latest.current = { byId, color, tooltip, onSelect, selected };

  const style = (id: string) => {
    const item = latest.current.byId.get(id);
    const isSel = latest.current.selected === id;
    return { fillColor: item ? latest.current.color(item) : 'var(--map-empty)', fillOpacity: 1, color: isSel ? 'var(--accent)' : 'var(--map-stroke)', weight: isSel ? 3 : 0.45 };
  };

  useEffect(() => {
    layers.current.forEach(({ path, name }, id) => {
      path.setStyle(style(id));
      const item = byId.get(id);
      path.setTooltipContent(item ? tooltip(item) : `<strong>${escapeHtml(name ?? 'District')}</strong><br/>No matching forecast`);
      if (selected === id) path.bringToFront();
    });
  });

  if (districts.isError || states.isError) return <div className="pad"><ErrorState error={districts.error ?? states.error} onRetry={() => { void districts.refetch(); void states.refetch(); }} /></div>;
  if (!districts.data || !states.data) return <Skeleton height={height} className="map-skeleton" />;

  const onEach = (feature: Feature, layer: Layer) => {
    const id = feature.properties.district_id as string;
    const path = layer as Path;
    layers.current.set(id, { path, name: feature.properties.district });
    path.bindTooltip('', { sticky: true, direction: 'top', offset: [0, -8], className: 'map-tip' });
    path.on({
      mouseover: (e: LeafletMouseEvent) => { e.target.setStyle({ weight: 2, color: 'var(--text)' }); e.target.bringToFront(); },
      mouseout: (e: LeafletMouseEvent) => e.target.setStyle(style(id)),
      click: () => { if (latest.current.byId.has(id)) latest.current.onSelect?.(id); },
    });
  };

  return (
    <div role="group" aria-label="Map of India districts. Use the district list to select a district with the keyboard." style={{ height }}>
    <MapContainer bounds={INDIA} maxBounds={[[0, 58], [42, 108]]} minZoom={4} maxZoom={10} zoomSnap={0.25} scrollWheelZoom={false}
      attributionControl={false} zoomControl={false} className="leaflet-map" style={{ height }} renderer={L.svg({ padding: 0.5 })}>
      <FitIndia compact={compact} />
      {!compact && <ZoomControl position="bottomright" />}
      <AttributionControl prefix={false} />
      <GeoJSON data={districts.data as never} style={(f) => style(f?.properties?.district_id)} onEachFeature={onEach as never}
        attribution={`Boundaries: <a href="https://github.com/datta07/INDIAN-SHAPEFILES">datta07</a> (MIT)${live ? ' · NWP: <a href="https://open-meteo.com">Open-Meteo</a> (CC BY 4.0)' : ''}`} key={live ? 'live' : 'season'} />
      <Pane name="states" style={{ zIndex: 450, pointerEvents: 'none' }}>
        <GeoJSON data={states.data as never} interactive={false} style={{ fill: false, color: 'var(--map-state)', weight: 1.1, opacity: 0.9 }} />
      </Pane>
    </MapContainer>
    </div>
  );
}
