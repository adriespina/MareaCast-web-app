
export interface TideEvent {
  time: string; // HH:MM
  height: number; // meters
  type: 'HIGH' | 'LOW';
}

export interface SunCycle {
  sunrise: string; // HH:MM
  sunset: string; // HH:MM
}

export interface TideData {
  requestedName?: string;
  locationName: string;
  referenceLocationName?: string;
  coordinates?: { lat: number; lng: number };
  referenceCoordinates?: { lat: number; lng: number };
  requestedCoordinates?: { lat: number; lng: number };
  date: string;
  currentHeight: number;
  isRising: boolean;
  coefficient: number;
  sun: SunCycle;
  tides: TideEvent[];
  chartData: { time: number; height: number; label?: string }[]; // Interpolated points for graph, time in decimal hours (0-24)
}

export interface GeoLocation {
  lat: number;
  lng: number;
}
