import { TideData, TideEvent } from "../types";
import {
  generateTideCurve,
  calculateCurrentHeight,
  getHaversineDistance,
} from "../utils/tideMath";

// --- Interfaces para los datos de la API ---

interface IhmPort {
  id: string;
  code: string;
  puerto: string;
  lat: string;
  lon: string;
}

interface PortsApiResponse {
  estaciones: {
    copyright: string;
    puertos: IhmPort[];
  };
}

interface TideApiResponse {
  mareas: {
    copyright: string;
    id: string;
    puerto: string;
    fecha: string;
    ndatos: string;
    lat: string;
    lon: string;
    datos: {
      marea: Array<{
        hora: string;
        altura: string;
        tipo: "pleamar" | "bajamar";
      }>;
    };
  };
}

// --- Caché para la lista de puertos ---

let portsCache: IhmPort[] | null = null;

async function loadPorts(): Promise<IhmPort[]> {
  if (portsCache) {
    return portsCache;
  }
  try {
    const response = await fetch("/ihm-ports.json");
    if (!response.ok) {
      throw new Error(`Failed to fetch ihm-ports.json: ${response.statusText}`);
    }
    const data: PortsApiResponse = await response.json();
    portsCache = data.estaciones.puertos;
    return portsCache;
  } catch (error) {
    console.error("Could not load or parse ihm-ports.json:", error);
    // Retorna un array vacío si falla para no bloquear la app
    return [];
  }
}

// --- Funciones de Lógica de API ---

/**
 * Geocodifica un nombre de lugar o coordenadas usando la API de Nominatim (OpenStreetMap).
 */
async function geocodeLocation(
  query: string
): Promise<{ lat: number; lng: number; name: string } | null> {
  try {
    const coordMatch = query.match(/^(-?\d+\.?\d*),\s*(-?\d+\.?\d*)$/);
    if (coordMatch) {
      const lat = parseFloat(coordMatch[1]);
      const lng = parseFloat(coordMatch[2]);
      if (isNaN(lat) || isNaN(lng)) return null;
      // Para coordenadas, el nombre se resuelve después si es necesario.
      return { lat, lng, name: query };
    }

    const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(
      query
    )}&limit=1`;
    const response = await fetch(url, {
      headers: { "User-Agent": "MareaCast/1.0" },
    });
    if (!response.ok) throw new Error("Geocoding failed");

    const data = await response.json();
    if (!data || data.length === 0) return null;

    return {
      lat: parseFloat(data[0].lat),
      lng: parseFloat(data[0].lon),
      name: data[0].display_name,
    };
  } catch (error) {
    console.error("Geocoding error:", error);
    return null;
  }
}

/**
 * Encuentra el puerto más cercano de la lista a una latitud y longitud dadas.
 */
function findNearestPort(
  lat: number,
  lng: number,
  ports: IhmPort[]
): IhmPort | null {
  if (ports.length === 0) return null;

  let nearestPort: IhmPort | null = null;
  let minDistance = Infinity;

  for (const port of ports) {
    const portLat = parseFloat(port.lat);
    const portLon = parseFloat(port.lon);
    const distance = getHaversineDistance(lat, lng, portLat, portLon);

    if (distance < minDistance) {
      minDistance = distance;
      nearestPort = port;
    }
  }

  console.log(
    `Nearest port found: ${nearestPort?.puerto} at ${minDistance.toFixed(2)} km`
  );
  return nearestPort;
}

/**
 * Obtiene los datos de mareas para un ID de puerto específico desde la API de ideihm.
 */
async function getTideDataFromIdeihm(
  portId: string
): Promise<TideApiResponse | null> {
  const today = new Date();
  const dateStr = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(
    2,
    "0"
  )}${String(today.getDate()).padStart(2, "0")}`;
  const url = `https://ideihm.covam.es/api-ihm/getmarea?request=gettide&id=${portId}&format=json&date=${dateStr}`;

  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`API request failed with status ${response.status}`);
    }
    const data: TideApiResponse = await response.json();
    return data;
  } catch (error) {
    console.error(`Failed to fetch or parse tide data from IHM API:`, error);
    return null;
  }
}

/**
 * Obtiene datos de salida y puesta del sol.
 */
async function getSunTimes(
  lat: number,
  lng: number
): Promise<{ sunrise: string; sunset: string }> {
  try {
    const today = new Date();
    const dateStr = `${today.getFullYear()}-${String(
      today.getMonth() + 1
    ).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    const url = `https://api.sunrise-sunset.org/json?lat=${lat}&lng=${lng}&date=${dateStr}&formatted=0`;

    const response = await fetch(url);
    if (!response.ok) throw new Error("Sun API failed");

    const data = await response.json();
    if (data.status !== "OK") throw new Error("Sun API returned error");

    const formatTime = (date: Date) => {
      const hours = String(date.getHours()).padStart(2, "0");
      const minutes = String(date.getMinutes()).padStart(2, "0");
      return `${hours}:${minutes}`;
    };

    return {
      sunrise: formatTime(new Date(data.results.sunrise)),
      sunset: formatTime(new Date(data.results.sunset)),
    };
  } catch (error) {
    console.error("Sun API error:", error);
    return { sunrise: "07:00", sunset: "20:00" }; // Fallback
  }
}

// --- Función Principal ---

/**
 * Orquesta la obtención de datos de mareas.
 */
export const fetchTideData = async (
  locationQuery: string
): Promise<TideData> => {
  // 1. Cargar la lista de puertos (usará la caché si ya está cargada)
  const allPorts = await loadPorts();
  if (allPorts.length === 0) {
    throw new Error(
      "La lista de puertos de IHM no pudo ser cargada. Inténtalo de nuevo más tarde."
    );
  }

  // 2. Geocodificar la consulta del usuario
  const geoData = await geocodeLocation(locationQuery);
  if (!geoData) {
    throw new Error(
      `No se pudo encontrar la ubicación: "${locationQuery}". Por favor, introduce un nombre de lugar o coordenadas válidas.`
    );
  }

  // 3. Encontrar el puerto más cercano
  const nearestPort = findNearestPort(geoData.lat, geoData.lng, allPorts);
  if (!nearestPort) {
    throw new Error(
      "No se encontró ningún puerto de medición cercano a la ubicación proporcionada."
    );
  }

  // 4. Obtener los datos de mareas para el puerto encontrado
  const tideApiResponse = await getTideDataFromIdeihm(nearestPort.id);
  if (!tideApiResponse || !tideApiResponse.mareas.datos.marea) {
    throw new Error(
      `No se pudieron obtener los datos de mareas para ${nearestPort.puerto}.`
    );
  }

  const { mareas } = tideApiResponse;

  // 5. Transformar los datos al formato de la aplicación
  const tides: TideEvent[] = mareas.datos.marea.map((m) => ({
    time: m.hora,
    height: parseFloat(m.altura),
    type: m.tipo === "pleamar" ? "HIGH" : "LOW",
  }));

  // 6. Obtener datos del sol (en paralelo)
  const sunData = await getSunTimes(
    parseFloat(mareas.lat),
    parseFloat(mareas.lon)
  );

  // 7. Calcular datos derivados para la UI
  const { height: currentHeight, isRising } = calculateCurrentHeight(tides);
  const chartData = generateTideCurve(tides);

  const heights = tides.map((t) => t.height);
  const range = Math.max(...heights) - Math.min(...heights);
  const coefficient = Math.min(120, Math.max(20, Math.round((range / 4) * 100)));

  // 8. Devolver el objeto de datos completo
  return {
    requestedName: locationQuery,
    locationName: mareas.puerto,
    coordinates: {
      lat: parseFloat(mareas.lat),
      lng: parseFloat(mareas.lon),
    },
    date: new Date().toLocaleDateString("es-ES"),
    coefficient,
    sun: sunData,
    tides: tides.sort((a, b) => a.time.localeCompare(b.time)),
    currentHeight,
    isRising,
    chartData,
  };
};
