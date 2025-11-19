import React from 'react';
import { MapPin } from 'lucide-react';

interface MapViewProps {
  locationName?: string;
  coordinates?: { lat: number; lng: number };
}

export const MapView: React.FC<MapViewProps> = ({ locationName, coordinates }) => {
  // Construct the Embed URL.
  // t=h (hybrid) looks better for coastal/nature apps than standard roadmap (m)
  // z=13 is a good zoom level for town/coastal areas
  const mapUrl = coordinates 
    ? `https://maps.google.com/maps?q=${coordinates.lat},${coordinates.lng}&t=h&z=13&ie=UTF8&iwloc=&output=embed`
    : locationName 
      ? `https://maps.google.com/maps?q=${encodeURIComponent(locationName)}&t=h&z=12&ie=UTF8&iwloc=&output=embed`
      : "";

  return (
    <div className="w-full h-56 md:h-72 bg-ocean-900 relative overflow-hidden border-b border-ocean-600 shadow-inner group">
      {mapUrl ? (
        <iframe
          width="100%"
          height="100%"
          src={mapUrl}
          className="w-full h-full opacity-80 group-hover:opacity-100 transition-opacity duration-500"
          style={{ 
            border: 0, 
            // CSS filters to darken the map to match the app theme
            filter: 'grayscale(20%) contrast(1.1) brightness(0.85)' 
          }}
          allowFullScreen
          loading="lazy"
          referrerPolicy="no-referrer-when-downgrade"
          title={`Mapa de ${locationName}`}
        />
      ) : (
        <div className="w-full h-full flex items-center justify-center text-ocean-400 bg-ocean-900">
          <div className="flex flex-col items-center animate-pulse">
            <MapPin size={32} className="mb-2 opacity-50" />
            <span>Cargando mapa...</span>
          </div>
        </div>
      )}
      
      {/* Overlay gradient for smooth transition to app content at the bottom */}
      <div className="absolute bottom-0 left-0 w-full h-16 bg-gradient-to-t from-ocean-800 to-transparent pointer-events-none"></div>
      
      {/* Location badge overlay */}
      {locationName && (
        <div className="absolute top-4 left-4 bg-ocean-900/80 backdrop-blur-md px-3 py-1 rounded-full border border-ocean-600/50 text-xs font-mono text-blue-300 shadow-lg pointer-events-none">
          Lat: {coordinates?.lat.toFixed(4) || '?'} • Lng: {coordinates?.lng.toFixed(4) || '?'}
        </div>
      )}
    </div>
  );
};