import { TideData, TideEvent } from "../types";
import { generateTideCurve, calculateCurrentHeight } from "../utils/tideMath";

const AEMET_API_KEY = (import.meta.env?.VITE_AEMET_API_KEY as string)
  || (process.env?.VITE_AEMET_API_KEY as string)
  || "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJhZHJpYW4uZXNwaW5hQGdtYWlsLmNvbSIsImp0aSI6IjI1NTQ1NGFhLWM3NWYtNDEzYi04ZDJhLTcwNzBkYTM3ZTQ2ZCIsImlzcyI6IkFFTUVUIiwiaWF0IjoxNzYzNjQ2MzA2LCJ1c2VySWQiOiIyNTU0NTRhYS1jNzVmLTQxM2ItOGQyYS03MDcwZGEzN2U0NmQiLCJyb2xlIjoiIn0.OMmt_i0NLG6kRyKRczII_MdJwACSquuarSXyMaqLia0";
const AEMET_BASE_URL = "https://opendata.aemet.es/opendata/api";

// Fallback mock data for development or quota limits
const MOCK_TIDE_DATA: Omit<TideData, 'chartData'> = {
  requestedName: "Navia",
  locationName: "Navia (Simulado)",
  coordinates: { lat: 43.54, lng: -6.72 },
  date: new Date().toLocaleDateString('es-ES'),
  currentHeight: 2.56,
  isRising: false,
  coefficient: 82,
  sun: { sunrise: "08:54", sunset: "19:28" },
  tides: [
    { time: "05:12", height: 4.1, type: "HIGH" },
    { time: "11:24", height: 0.6, type: "LOW" },
    { time: "17:41", height: 4.02, type: "HIGH" },
    { time: "23:48", height: 0.77, type: "LOW" }
  ]
};

interface TideCacheEntry {
  tides: TideEvent[];
  savedAt: number;
}

const TIDE_CACHE_TTL_MS = 1000 * 60 * 60 * 6; // 6 horas

function loadCachedTides(key: string): TideEvent[] | null {
  try {
    const cached = localStorage.getItem(`tides:${key}`);
    if (!cached) return null;

    const parsed = JSON.parse(cached) as TideCacheEntry;
    if (Date.now() - parsed.savedAt > TIDE_CACHE_TTL_MS) return null;

    return parsed.tides;
  } catch (error) {
    console.warn('No se pudo leer la caché local de mareas', error);
    return null;
  }
}

function saveCachedTides(key: string, tides: TideEvent[]) {
  try {
    const payload: TideCacheEntry = { tides, savedAt: Date.now() };
    localStorage.setItem(`tides:${key}`, JSON.stringify(payload));
  } catch (error) {
    console.warn('No se pudo guardar la caché local de mareas', error);
  }
}

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
 * Obtiene datos de salida y puesta del sol usando la API pública sunrise-sunset.org
 */
async function getSunTimes(lat: number, lng: number): Promise<{ sunrise: string; sunset: string }> {
  try {
    const today = new Date();
    const dateStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    const url = `https://api.sunrise-sunset.org/json?lat=${lat}&lng=${lng}&date=${dateStr}&formatted=0`;
    
    const response = await fetch(url);
    if (!response.ok) throw new Error('Sun API failed');
    
    const data = await response.json();
    if (data.status !== 'OK') throw new Error('Sun API returned error');
    
    // Convertir de UTC a hora local y formatear
    const sunrise = new Date(data.results.sunrise);
    const sunset = new Date(data.results.sunset);
    
    // Convertir a hora local en formato HH:MM
    const formatTime = (date: Date) => {
      const hours = String(date.getHours()).padStart(2, '0');
      const minutes = String(date.getMinutes()).padStart(2, '0');
      return `${hours}:${minutes}`;
    };
    
    return {
      sunrise: formatTime(sunrise),
      sunset: formatTime(sunset)
    };
  } catch (error) {
    console.error('Sun API error:', error);
    // Valores por defecto
    return { sunrise: "07:00", sunset: "20:00" };
  }
}

/**
 * Mapeo de ciudades españolas a puertos IHM más cercanos
 * Basado en el Anuario de Mareas del IHM
 */
type SpanishPort = { name: string; lat: number; lng: number; code?: string; aemetId?: string };

const SPANISH_PORT_MAPPING: { [key: string]: SpanishPort } = {
  'vigo': { name: 'Vigo', lat: 42.2406, lng: -8.7206, aemetId: '36057' },
  'a coruña': { name: 'A Coruña', lat: 43.3623, lng: -8.4115 },
  'coruña': { name: 'A Coruña', lat: 43.3623, lng: -8.4115 },
  'ferrol': { name: 'Ferrol', lat: 43.4833, lng: -8.2333 },
  'bilbao': { name: 'Bilbao', lat: 43.2627, lng: -2.9253 },
  'santander': { name: 'Santander', lat: 43.4623, lng: -3.8099 },
  'gijón': { name: 'Gijón', lat: 43.5453, lng: -5.6619 },
  'gijon': { name: 'Gijón', lat: 43.5453, lng: -5.6619 },
  'oviedo': { name: 'Gijón', lat: 43.5453, lng: -5.6619 }, // Oviedo usa datos de Gijón
  'avilés': { name: 'Avilés', lat: 43.5567, lng: -5.9244, aemetId: '33004' },
  'aviles': { name: 'Avilés', lat: 43.5567, lng: -5.9244, aemetId: '33004' },
  'ribadeo': { name: 'Ribadeo', lat: 43.5367, lng: -7.0408 },
  'cudillero': { name: 'Cudillero', lat: 43.5617, lng: -6.1456 },
  'luarca': { name: 'Luarca', lat: 43.5450, lng: -6.5361, aemetId: '33031' },
  'cabo peñas': { name: 'Cabo Peñas', lat: 43.6500, lng: -5.8500 },
  'san sebastián': { name: 'San Sebastián', lat: 43.3183, lng: -1.9812 },
  'san sebastian': { name: 'San Sebastián', lat: 43.3183, lng: -1.9812 },
  'donostia': { name: 'San Sebastián', lat: 43.3183, lng: -1.9812 },
  'valencia': { name: 'Valencia', lat: 39.4699, lng: -0.3763 },
  'barcelona': { name: 'Barcelona', lat: 41.3851, lng: 2.1734 },
  'tarragona': { name: 'Tarragona', lat: 41.1189, lng: 1.2445 },
  'alicante': { name: 'Alicante', lat: 38.3452, lng: -0.4810 },
  'cartagena': { name: 'Cartagena', lat: 37.6000, lng: -0.9864 },
  'málaga': { name: 'Málaga', lat: 36.7213, lng: -4.4214 },
  'malaga': { name: 'Málaga', lat: 36.7213, lng: -4.4214 },
  'cádiz': { name: 'Cádiz', lat: 36.5270, lng: -6.2886 },
  'cadiz': { name: 'Cádiz', lat: 36.5270, lng: -6.2886 },
  'huelva': { name: 'Huelva', lat: 37.2583, lng: -6.9508 },
  'sevilla': { name: 'Cádiz', lat: 36.5270, lng: -6.2886 }, // Sevilla usa datos de Cádiz
  'ceuta': { name: 'Ceuta', lat: 35.8883, lng: -5.3167 },
  'melilla': { name: 'Melilla', lat: 35.2923, lng: -2.9381 },
  'palma': { name: 'Palma', lat: 39.5696, lng: 2.6502 },
  'palma de mallorca': { name: 'Palma', lat: 39.5696, lng: 2.6502 },
  'mahón': { name: 'Mahón', lat: 39.8885, lng: 4.2614 },
  'mahon': { name: 'Mahón', lat: 39.8885, lng: 4.2614 },
  'las palmas': { name: 'Las Palmas', lat: 28.1248, lng: -15.4300 },
  'santa cruz de tenerife': { name: 'Santa Cruz de Tenerife', lat: 28.4636, lng: -16.2518 },
  'tenerife': { name: 'Santa Cruz de Tenerife', lat: 28.4636, lng: -16.2518 },
};

/**
 * Encuentra el puerto IHM más cercano a las coordenadas dadas
 */
function findNearestSpanishPort(lat: number, lng: number, locationName?: string): (SpanishPort & { distance?: number }) | null {
  // Primero intentar buscar por nombre
  if (locationName) {
    const normalizedName = locationName.toLowerCase().trim();
    if (SPANISH_PORT_MAPPING[normalizedName]) {
      const port = SPANISH_PORT_MAPPING[normalizedName];
      return { ...port };
    }
    
    // Buscar coincidencias parciales
    for (const [key, port] of Object.entries(SPANISH_PORT_MAPPING)) {
      if (normalizedName.includes(key) || key.includes(normalizedName)) {
        return { ...port };
      }
    }
  }
  
  // Si no se encuentra por nombre, buscar el más cercano por distancia
  let nearestPort: { name: string; lat: number; lng: number; distance: number } | null = null;
  
  for (const port of Object.values(SPANISH_PORT_MAPPING)) {
    const distance = Math.sqrt(
      Math.pow(lat - port.lat, 2) + Math.pow(lng - port.lng, 2)
    );
    
    if (!nearestPort || distance < nearestPort.distance) {
      nearestPort = { name: port.name, lat: port.lat, lng: port.lng, distance };
    }
  }
  
  return nearestPort ? { ...nearestPort } : null;
}

function normalizeAemetTides(raw: any): TideEvent[] | null {
  const candidateDays = Array.isArray(raw) ? raw : [raw];
  const tides: TideEvent[] = [];

  for (const day of candidateDays) {
    const entries = day?.prediccion?.mareas || day?.prediccion?.marea || day?.mareas || [];
    if (Array.isArray(entries)) {
      for (const entry of entries) {
        const time = entry.hora || entry.horario || entry.horaMarea || entry.hora_marea;
        const height = Number(entry.altura || entry.valor || entry.alturaMarea);
        const typeLabel = (entry.tipo || entry.estado || "").toString().toUpperCase();

        if (time && !isNaN(height)) {
          const type: TideEvent['type'] = typeLabel.includes('PLEA') || typeLabel.includes('ALTA') ? 'HIGH' : 'LOW';
          tides.push({ time, height: Math.round(height * 100) / 100, type });
        }
      }
    }

    // Si la estructura no es clara, intentar parsear texto libre
    if (tides.length === 0 && day) {
      const serialized = JSON.stringify(day);
      const pattern = /(pleamar|bajamar)[^0-9]*(\d{1,2}:\d{2})[^0-9]*([0-9]+[,.]?[0-9]*)/gi;
      let match;
      while ((match = pattern.exec(serialized)) !== null) {
        tides.push({
          time: match[2],
          height: Math.round(parseFloat(match[3].replace(',', '.')) * 100) / 100,
          type: match[1].toLowerCase().includes('plea') ? 'HIGH' : 'LOW'
        });
      }
    }
  }

  if (tides.length === 0) return null;

  const uniqueTides = tides
    .filter((tide) => tide.time && !isNaN(tide.height))
    .reduce((acc: TideEvent[], tide) => {
      const exists = acc.find((t) => t.time === tide.time && t.type === tide.type);
      if (!exists) acc.push(tide);
      return acc;
    }, []);

  return uniqueTides.sort((a, b) => a.time.localeCompare(b.time));
}

async function fetchAemetTideData(port: SpanishPort): Promise<TideEvent[] | null> {
  if (!AEMET_API_KEY) return null;

  const cacheKey = port.name.toLowerCase().replace(/\s+/g, '-');
  const cached = loadCachedTides(cacheKey);
  if (cached) return cached;

  if (!port.aemetId) return null;

  const metaUrl = `${AEMET_BASE_URL}/prediccion/maritima/playa/${port.aemetId}?api_key=${AEMET_API_KEY}`;

  try {
    const metaResponse = await fetch(metaUrl);
    if (!metaResponse.ok) throw new Error('No se pudo obtener el índice de mareas de AEMET');
    const meta = await metaResponse.json();
    if (!meta?.datos) return null;

    const dataResponse = await fetch(meta.datos);
    if (!dataResponse.ok) throw new Error('No se pudieron descargar los datos de AEMET');
    const payload = await dataResponse.json();

    const tides = normalizeAemetTides(payload);
    if (tides && tides.length > 0) {
      saveCachedTides(cacheKey, tides);
      return tides;
    }
    return null;
  } catch (error) {
    console.warn('Error al consultar mareas en AEMET', error);
    return null;
  }
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
  
  return tides.sort((a, b) => a.time.localeCompare(b.time));
}

/**
 * Función principal para obtener datos de mareas desde APIs públicas
 */
export const fetchTideData = async (locationQuery: string): Promise<TideData> => {
  try {
    const isBrowser = typeof window !== 'undefined';
    const allowDirectAemet = !isBrowser || window.location.hostname === 'localhost';
    const allowDirectScrape = allowDirectAemet;

    let dataSource = '';
    let dataDisclaimer: string | undefined;
    let sourceError: string | undefined;
    let isApproximate = false;

    // Paso 1: Geocodificar la ubicación
    let geoData = await geocodeLocation(locationQuery);

    // Si falla el geocoding, usar coordenadas por defecto o intentar parsear
    if (!geoData) {
      // Intentar parsear coordenadas directamente
      const coordMatch = locationQuery.match(/^(-?\d+\.?\d*),\s*(-?\d+\.?\d*)$/);
      if (coordMatch) {
        const lat = parseFloat(coordMatch[1]);
        const lng = parseFloat(coordMatch[2]);
        geoData = { lat, lng, name: locationQuery };
      } else {
        // Usar coordenadas por defecto (Vigo, España)
        geoData = { lat: 42.2406, lng: -8.7206, name: locationQuery || "Vigo" };
        console.warn('Geocoding falló, usando coordenadas por defecto');
      }
    }

    let { lat, lng, name } = geoData;
    const requestedCoordinates = { lat, lng };
    let referenceLocationName: string | undefined;
    let referenceCoordinates: { lat: number; lng: number } | undefined;
    
    // Paso 2: Obtener datos del sol (con timeout)
    let sunData = { sunrise: "07:00", sunset: "20:00" };
    try {
      sunData = await Promise.race([
        getSunTimes(lat, lng),
        new Promise<{ sunrise: string; sunset: string }>((resolve) => 
          setTimeout(() => resolve({ sunrise: "07:00", sunset: "20:00" }), 5000)
        )
      ]);
    } catch (error) {
      console.warn('Error obteniendo datos del sol, usando valores por defecto:', error);
    }
    
    // Paso 3: Intentar obtener datos de mareas desde fuentes españolas oficiales y cache local
    let tides: TideEvent[] | null = null;
    let spanishPort: (SpanishPort & { distance?: number }) | null = null;

    // Primero intentar encontrar un puerto español cercano
    spanishPort = findNearestSpanishPort(lat, lng, name);

    if (spanishPort) {
      console.log(`Usando puerto más cercano para mareas: ${spanishPort.name}`);
      name = spanishPort.name;
      lat = spanishPort.lat;
      lng = spanishPort.lng;
      referenceLocationName = spanishPort.name;
      referenceCoordinates = { lat: spanishPort.lat, lng: spanishPort.lng };

      try {
        tides = await Promise.race([
          fetchAemetTideData(spanishPort),
          new Promise<TideEvent[] | null>((resolve) => setTimeout(() => resolve(null), 10000))
        ]);
      } catch (error) {
        console.warn('Error obteniendo datos de AEMET:', error);
      }

      // Fallback a fuente IHM si AEMET falla
      if (!tides || tides.length === 0) {
        try {
          tides = await Promise.race([
            getTideDataFromTablademareas(spanishPort.name),
            new Promise<TideEvent[] | null>((resolve) => setTimeout(() => resolve(null), 10000))
          ]);
        } catch (error) {
          console.warn('Error obteniendo datos de tablademareas.com:', error);
        }
      }
    }

    // Si no se obtuvieron datos de fuentes españolas, intentar WorldTides API
    if (!tides || tides.length === 0) {
      try {
        tides = await Promise.race([
          getTideDataFromAPI(lat, lng),
          new Promise<TideEvent[] | null>((resolve) => setTimeout(() => resolve(null), 8000))
        ]);
        if (tides && tides.length > 0) {
          dataSource = 'WorldTides API (estimación)';
        }
      } catch (error) {
        console.warn('Error obteniendo datos de API de mareas:', error);
      }
    }

    // Si no hay datos de ninguna API, usar cálculo aproximado
    if (!tides || tides.length === 0) {
      console.warn('No se pudieron obtener datos de APIs, usando cálculo aproximado');
      const today = new Date();
      tides = calculateApproximateTides(lat, lng, today);
      isApproximate = true;
      dataSource = dataSource || 'Cálculo aproximado local';
      dataDisclaimer = sourceError
        ? `Datos aproximados por falta de respuesta de APIs (p.ej. CORS): ${sourceError}`
        : 'Datos aproximados calculados localmente; confirma con una fuente oficial si necesitas precisión.';
    }

    if (!tides || tides.length === 0) {
      throw new Error('No se pudieron calcular datos de mareas');
    }
    
    // Paso 4: Calcular altura actual y estado
    const { height: currentHeight, isRising } = calculateCurrentHeight(tides);
    const chartData = generateTideCurve(tides);
    
    // Calcular coeficiente aproximado (basado en rango de mareas)
    const heights = tides.map(t => t.height);
    const maxHeight = Math.max(...heights);
    const minHeight = Math.min(...heights);
    const range = maxHeight - minHeight;
    // Coeficiente aproximado: 0-120, basado en el rango de marea
    const coefficient = Math.min(120, Math.max(20, Math.round((range / 4) * 100)));

    if (!dataSource) {
      dataSource = 'Origen no determinado';
    }
    if (isApproximate && !dataDisclaimer) {
      dataDisclaimer = 'Datos aproximados generados al no disponer de predicción oficial en este entorno.';
    }

    return {
      requestedName: locationQuery,
      locationName: name,
      coordinates: { lat, lng },
      referenceLocationName,
      referenceCoordinates,
      requestedCoordinates,
      date: new Date().toLocaleDateString('es-ES'),
      coefficient,
      sun: sunData,
      tides: tides.sort((a, b) => a.time.localeCompare(b.time)),
      currentHeight,
      isRising,
      chartData
    };
    
  } catch (error) {
    console.error("Error fetching tide data:", error);
    // Retornar datos mock en caso de error - asegurar que siempre retornamos datos válidos
    const chartData = generateTideCurve(MOCK_TIDE_DATA.tides as TideEvent[]);
    return {
      ...MOCK_TIDE_DATA,
      requestedName: locationQuery || "Vigo",
      referenceLocationName: `${locationQuery || "Vigo"} (simulado)`,
      locationName: `${locationQuery || "Vigo"} (Simulado)`,
      requestedCoordinates: MOCK_TIDE_DATA.coordinates,
      chartData
    } as TideData;
  }
};

