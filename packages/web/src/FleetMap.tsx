import { useEffect, useRef, useState } from 'react';
import { Map as MlMap, type GeoJSONSource } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { FleetState } from './state.js';

const TILE_URL: string = import.meta.env?.VITE_TILE_URL ?? 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const CENTER: [number, number] = [11.5755, 48.1374];

const empty = { type: 'FeatureCollection' as const, features: [] };

interface Props {
  state: FleetState;
  onSelect: (id: string | null) => void;
}

/** The map is created once; React state only feeds `setData` on the three GeoJSON sources. */
export function FleetMap({ state, onSelect }: Props) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<MlMap | null>(null);
  const [loaded, setLoaded] = useState(false);
  const select = useRef(onSelect);
  select.current = onSelect;

  useEffect(() => {
    if (!el.current) return;
    const m: MlMap = new MlMap({
      container: el.current,
      center: CENTER,
      zoom: 12,
      attributionControl: { compact: true },
      style: {
        version: 8,
        sources: {
          osm: { type: 'raster', tiles: [TILE_URL], tileSize: 256, attribution: '© OpenStreetMap contributors', maxzoom: 19 },
        },
        layers: [
          { id: 'bg', type: 'background', paint: { 'background-color': '#161a1f' } },
          { id: 'osm', type: 'raster', source: 'osm', paint: { 'raster-opacity': 0.55, 'raster-saturation': -0.6, 'raster-brightness-max': 0.7 } },
        ],
      },
    });
    map.current = m;
    m.on('load', () => {
      m.addSource('geofences', { type: 'geojson', data: empty });
      m.addSource('vehicles', { type: 'geojson', data: empty });
      m.addSource('trail', { type: 'geojson', data: empty });
      m.addLayer({ id: 'geofence-fill', type: 'fill', source: 'geofences', paint: { 'fill-color': '#34d399', 'fill-opacity': 0.14 } });
      m.addLayer({ id: 'geofence-line', type: 'line', source: 'geofences', paint: { 'line-color': '#34d399', 'line-width': 2 } });
      m.addLayer({ id: 'trail', type: 'line', source: 'trail', paint: { 'line-color': '#e5e7eb', 'line-width': 2, 'line-opacity': 0.8 } });
      m.addLayer({
        id: 'vehicles', type: 'circle', source: 'vehicles',
        paint: {
          'circle-radius': ['case', ['==', ['get', 'selected'], 1], 9, 6],
          'circle-color': ['case', ['==', ['get', 'online'], 0], '#6b7280',
            ['step', ['get', 'speedKph'], '#60a5fa', 20, '#38bdf8', 40, '#fbbf24', 60, '#fb923c']],
          'circle-stroke-width': ['case', ['==', ['get', 'selected'], 1], 3, 1.5],
          'circle-stroke-color': '#0b0d10',
        },
      });
      m.on('click', 'vehicles', (e) => {
        const id = e.features?.[0]?.properties?.id as string | undefined;
        if (id) select.current(id);
      });
      m.on('mouseenter', 'vehicles', () => { m.getCanvas().style.cursor = 'pointer'; });
      m.on('mouseleave', 'vehicles', () => { m.getCanvas().style.cursor = ''; });
      setLoaded(true);
    });
    return () => { setLoaded(false); m.remove(); map.current = null; };
  }, []);

  useEffect(() => {
    const m = map.current;
    if (!m || !loaded) return;
    const vehicles = Object.entries(state.vehicles).map(([id, v]) => ({
      type: 'Feature' as const,
      properties: { id, speedKph: v.telemetry.speedKph, online: v.online ? 1 : 0, selected: state.selected === id ? 1 : 0 },
      geometry: { type: 'Point' as const, coordinates: [v.telemetry.lon, v.telemetry.lat] },
    }));
    (m.getSource('vehicles') as GeoJSONSource | undefined)?.setData({ type: 'FeatureCollection', features: vehicles });
    const sel = state.selected ? state.vehicles[state.selected] : undefined;
    (m.getSource('trail') as GeoJSONSource | undefined)?.setData(
      sel && sel.trail.length > 1
        ? { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: sel.trail } }] }
        : empty,
    );
  }, [loaded, state.vehicles, state.selected]);

  useEffect(() => {
    const m = map.current;
    if (!m || !loaded || !state.geofences) return;
    (m.getSource('geofences') as GeoJSONSource | undefined)?.setData(state.geofences as never);
  }, [loaded, state.geofences]);

  return <div ref={el} className="map" aria-label="Live fleet map" />;
}
