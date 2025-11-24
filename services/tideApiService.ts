import { TideData, TideEvent } from "../types";
import {
  generateTideCurve,
  calculateCurrentHeight,
  getHaversineDistance,
} from "../utils/tideMath";

const AEMET_API_KEY =
  (import.meta.env?.VITE_AEMET_API_KEY as string) ||
  (process.env?.VITE_AEMET_API_KEY as string) ||
  "";
const AEMET_BASE_URL = "https://opendata.aemet.es/opendata/api";

const MOCK_TIDE_DATA: Omit<TideData, "chartData"> = {
  requestedName: "Navia",
  locationName: "Navia (Simulado)",
  coordinates: { lat: 43.54, lng: -6.72 },
  date: new Date().toLocaleDateString("es-ES"),
  currentHeight: 2.56,
  isRising: false,
  coefficient: 82,
  sun: { sunrise: "08:54", sunset: "19:28" },
  tides: [
    { time: "05:12", height: 4.1, type: "HIGH" },
    { time: "11:24", height: 0.6, type: "LOW" },
    { time: "17:41", height: 4.02, type: "HIGH" },
    { time: "23:48", height: 0.77, type: "LOW" },
  ],
};

interface TideCacheEntry {
  tides: TideEvent[];
  savedAt: number;
}

const TIDE_CACHE_TTL_MS = 1000 * 60 * 60 * 6; // 6 horas
const hasLocalStorage = typeof localStorage !== "undefined";

const DEFAULT_COORDS = { lat: 42.2406, lng: -8.7206, name: "Vigo" };

function loadCachedTides(key: string): TideEvent[] | null {
  if (!hasLocalStorage) return null;
  try {
    const cached = localStorage.getItem(`tides:${key}`);
    if (!cached) return null;

    const parsed = JSON.parse(cached) as TideCacheEntry;
    if (Date.now() - parsed.savedAt > TIDE_CACHE_TTL_MS) return null;

    return parsed.tides;
  } catch (error) {
    console.warn("No se pudo leer la caché local de mareas", error);
    return null;
  }
}

function saveCachedTides(key: string, tides: TideEvent[]) {
  if (!hasLocalStorage) return;
  try {
    const payload: TideCacheEntry = { tides, savedAt: Date.now() };
    localStorage.setItem(`tides:${key}`, JSON.stringify(payload));
  } catch (error) {
    console.warn("No se pudo guardar la caché local de mareas", error);
  }
}

const normalizeKey = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();

/**
 * Geocodifica un nombre de lugar o coordenadas usando la API de Nominatim (OpenStreetMap).
 */
async function geocodeLocation(
  query: string,
): Promise<{ lat: number; lng: number; name: string } | null> {
  try {
    const coordMatch = query.match(/^(-?\d+\.?\d*),\s*(-?\d+\.?\d*)$/);
    if (coordMatch) {
      const lat = parseFloat(coordMatch[1]);
      const lng = parseFloat(coordMatch[2]);
      if (Number.isNaN(lat) || Number.isNaN(lng)) return null;
      return { lat, lng, name: query };
    }

    const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(
      query,
    )}&limit=1`;
    const response = await fetch(url, {
      headers: { "User-Agent": "MareaCast/1.0" },
    });
    if (!response.ok) throw new Error("Geocodificación fallida");

    const data = await response.json();
    if (!data || data.length === 0) return null;

    return {
      lat: parseFloat(data[0].lat),
      lng: parseFloat(data[0].lon),
      name: data[0].display_name,
    };
  } catch (error) {
    console.error("Error de geocodificación:", error);
    return null;
  }
}

/**
 * Obtiene datos de salida y puesta del sol usando la API pública sunrise-sunset.org
 */
async function getSunTimes(
  lat: number,
  lng: number,
): Promise<{ sunrise: string; sunset: string }> {
  try {
    const today = new Date();
    const dateStr = `${today.getFullYear()}-${String(
      today.getMonth() + 1,
    ).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    const url = `https://api.sunrise-sunset.org/json?lat=${lat}&lng=${lng}&date=${dateStr}&formatted=0`;

    const response = await fetch(url);
    if (!response.ok) throw new Error("Fallo en la API de amanecer/atardecer");

    const data = await response.json();
    if (data.status !== "OK") throw new Error("La API de sol devolvió error");

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
    console.error("Error obteniendo datos del sol:", error);
    return { sunrise: "07:00", sunset: "20:00" };
  }
}

/**
 * Mapeo de ciudades españolas a puertos IHM cercanos.
 */
type SpanishPort = {
  name: string;
  lat: number;
  lng: number;
  code?: string;
  aemetId?: string;
};

const SPANISH_PORT_MAPPING: Record<string, SpanishPort> = {
  vigo: { name: "Vigo", lat: 42.2406, lng: -8.7206, aemetId: "36057" },
  "a coruna": { name: "A Coruña", lat: 43.3623, lng: -8.4115 },
  coruna: { name: "A Coruña", lat: 43.3623, lng: -8.4115 },
  ferrol: { name: "Ferrol", lat: 43.4833, lng: -8.2333 },
  bilbao: { name: "Bilbao", lat: 43.2627, lng: -2.9253 },
  santander: { name: "Santander", lat: 43.4623, lng: -3.8099 },
  gijon: { name: "Gijón", lat: 43.5453, lng: -5.6619 },
  oviedo: { name: "Gijón", lat: 43.5453, lng: -5.6619 }, // Oviedo usa datos de Gijón
  aviles: { name: "Avilés", lat: 43.5567, lng: -5.9244, aemetId: "33004" },
  ribadeo: { name: "Ribadeo", lat: 43.5367, lng: -7.0408 },
  cudillero: { name: "Cudillero", lat: 43.5617, lng: -6.1456 },
  luarca: { name: "Luarca", lat: 43.545, lng: -6.5361, aemetId: "33031" },
  "cabo penas": { name: "Cabo Peñas", lat: 43.65, lng: -5.85 },
  "san sebastian": { name: "San Sebastián", lat: 43.3183, lng: -1.9812 },
  donostia: { name: "San Sebastián", lat: 43.3183, lng: -1.9812 },
  valencia: { name: "Valencia", lat: 39.4699, lng: -0.3763 },
  barcelona: { name: "Barcelona", lat: 41.3851, lng: 2.1734 },
  tarragona: { name: "Tarragona", lat: 41.1189, lng: 1.2445 },
  alicante: { name: "Alicante", lat: 38.3452, lng: -0.481 },
  cartagena: { name: "Cartagena", lat: 37.6, lng: -0.9864 },
  malaga: { name: "Málaga", lat: 36.7213, lng: -4.4214 },
  cadiz: { name: "Cádiz", lat: 36.527, lng: -6.2886 },
  huelva: { name: "Huelva", lat: 37.2583, lng: -6.9508 },
  sevilla: { name: "Cádiz", lat: 36.527, lng: -6.2886 }, // Sevilla usa datos de Cádiz
  ceuta: { name: "Ceuta", lat: 35.8883, lng: -5.3167 },
  melilla: { name: "Melilla", lat: 35.2923, lng: -2.9381 },
  palma: { name: "Palma", lat: 39.5696, lng: 2.6502 },
  "palma de mallorca": { name: "Palma", lat: 39.5696, lng: 2.6502 },
  mahon: { name: "Mahón", lat: 39.8885, lng: 4.2614 },
  "las palmas": { name: "Las Palmas", lat: 28.1248, lng: -15.43 },
  "santa cruz de tenerife": {
    name: "Santa Cruz de Tenerife",
    lat: 28.4636,
    lng: -16.2518,
  },
};

/**
 * Encuentra el puerto IHM más cercano a las coordenadas dadas.
 */
function findNearestSpanishPort(
  lat: number,
  lng: number,
  locationName?: string,
): (SpanishPort & { distanceKm?: number }) | null {
  const normalizedName = locationName ? normalizeKey(locationName) : "";
  const directMatch = normalizedName
    ? SPANISH_PORT_MAPPING[normalizedName]
    : undefined;

  let nearest: (SpanishPort & { distanceKm?: number }) | null = directMatch
    ? {
        ...directMatch,
        distanceKm: getHaversineDistance(
          lat,
          lng,
          directMatch.lat,
          directMatch.lng,
        ),
      }
    : null;

  for (const port of Object.values(SPANISH_PORT_MAPPING)) {
    const distanceKm = getHaversineDistance(lat, lng, port.lat, port.lng);
    if (
      !nearest ||
      (nearest.distanceKm ?? Number.POSITIVE_INFINITY) > distanceKm
    ) {
      nearest = { ...port, distanceKm };
    }
  }

  if (
    nearest &&
    nearest.distanceKm !== undefined &&
    nearest.distanceKm <= 250
  ) {
    return nearest;
  }

  return directMatch ? { ...directMatch } : null;
}

function normalizeAemetTides(raw: any): TideEvent[] | null {
  const candidateDays = Array.isArray(raw) ? raw : [raw];
  const tides: TideEvent[] = [];

  for (const day of candidateDays) {
    const entries =
      day?.prediccion?.mareas || day?.prediccion?.marea || day?.mareas || [];
    if (Array.isArray(entries)) {
      for (const entry of entries) {
        const time =
          entry.hora || entry.horario || entry.horaMarea || entry.hora_marea;
        const height = Number(entry.altura || entry.valor || entry.alturaMarea);
        const typeLabel = (entry.tipo || entry.estado || "")
          .toString()
          .toUpperCase();

        if (time && !Number.isNaN(height)) {
          const type: TideEvent["type"] =
            typeLabel.includes("PLEA") || typeLabel.includes("ALTA")
              ? "HIGH"
              : "LOW";
          tides.push({ time, height: Math.round(height * 100) / 100, type });
        }
      }
    }

    if (tides.length === 0 && day) {
      const serialized = JSON.stringify(day);
      const pattern =
        /(pleamar|bajamar)[^0-9]*(\d{1,2}:\d{2})[^0-9]*([0-9]+[,.]?[0-9]*)/gi;
      let match;
      while ((match = pattern.exec(serialized)) !== null) {
        tides.push({
          time: match[2],
          height:
            Math.round(parseFloat(match[3].replace(",", ".")) * 100) / 100,
          type: match[1].toLowerCase().includes("plea") ? "HIGH" : "LOW",
        });
      }
    }
  }

  if (tides.length === 0) return null;

  const uniqueTides = tides
    .filter((tide) => tide.time && !Number.isNaN(tide.height))
    .reduce((acc: TideEvent[], tide) => {
      const exists = acc.find(
        (t) => t.time === tide.time && t.type === tide.type,
      );
      if (!exists) acc.push(tide);
      return acc;
    }, []);

  return uniqueTides.sort((a, b) => a.time.localeCompare(b.time));
}

async function fetchAemetTideData(
  port: SpanishPort,
): Promise<TideEvent[] | null> {
  if (!AEMET_API_KEY || !port.aemetId) return null;

  const cacheKey = port.name.toLowerCase().replace(/\s+/g, "-");
  const cached = loadCachedTides(cacheKey);
  if (cached) return cached;

  const metaUrl = `${AEMET_BASE_URL}/prediccion/maritima/playa/${port.aemetId}?api_key=${AEMET_API_KEY}`;

  try {
    const metaResponse = await fetch(metaUrl);
    if (!metaResponse.ok)
      throw new Error("No se pudo obtener el índice de mareas de AEMET");
    const meta = await metaResponse.json();
    if (!meta?.datos) return null;

    const dataResponse = await fetch(meta.datos);
    if (!dataResponse.ok)
      throw new Error("No se pudieron descargar los datos de AEMET");
    const payload = await dataResponse.json();

    const tides = normalizeAemetTides(payload);
    if (tides && tides.length > 0) {
      saveCachedTides(cacheKey, tides);
      return tides;
    }
    return null;
  } catch (error) {
    console.warn("Error al consultar mareas en AEMET", error);
    return null;
  }
}

const formatTime = (minutesTotal: number): string => {
  const minutesNormalized = ((minutesTotal % (24 * 60)) + 24 * 60) % (24 * 60);
  const hours = Math.floor(minutesNormalized / 60);
  const minutes = minutesNormalized % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
};

function calculateApproximateTides(
  lat: number,
  lng: number,
  date = new Date(),
): TideEvent[] {
  const offsetMinutes = Math.round(((Math.abs(lng) % 180) / 180) * 60);
  const amplitude = 0.6 + Math.min(0.8, Math.abs(lat) / 180);
  const baseHigh = 3 + amplitude;
  const baseLow = Math.max(0.2, baseHigh - 2.4);

  const baseSchedule = [
    { hour: 2, minute: 0, type: "HIGH" as const, adjustment: 0 },
    { hour: 8, minute: 15, type: "LOW" as const, adjustment: 0.1 },
    { hour: 14, minute: 30, type: "HIGH" as const, adjustment: -0.2 },
    { hour: 20, minute: 45, type: "LOW" as const, adjustment: 0.05 },
  ];

  return baseSchedule.map((slot, index) => {
    const baseMinutes =
      slot.hour * 60 + slot.minute + offsetMinutes + index * 5;
    const height =
      slot.type === "HIGH"
        ? baseHigh + slot.adjustment
        : baseLow + slot.adjustment;
    return {
      time: formatTime(baseMinutes),
      height: Number(height.toFixed(2)),
      type: slot.type,
    };
  });
}

/**
 * Función principal para obtener datos de mareas desde fuentes públicas o aproximaciones locales.
 */
export const fetchTideData = async (
  locationQuery: string,
): Promise<TideData> => {
  const query = locationQuery?.trim() || DEFAULT_COORDS.name;

  try {
    let geoData = await geocodeLocation(query);
    if (!geoData) {
      console.warn(
        "Geocodificación falló, usando coordenadas por defecto (Vigo).",
      );
      geoData = DEFAULT_COORDS;
    }

    let { lat, lng, name } = geoData;
    const requestedCoordinates = { lat, lng };

    const sun = await Promise.race([
      getSunTimes(lat, lng),
      new Promise<{ sunrise: string; sunset: string }>((resolve) =>
        setTimeout(() => resolve({ sunrise: "07:00", sunset: "20:00" }), 5000),
      ),
    ]);

    let dataSource = "";
    let dataDisclaimer: string | undefined;
    let sourceError: string | undefined;
    let isApproximate = false;

    let referenceLocationName: string | undefined;
    let referenceCoordinates: { lat: number; lng: number } | undefined;
    let tides: TideEvent[] | null = null;

    const spanishPort = findNearestSpanishPort(lat, lng, name);
    if (
      spanishPort &&
      spanishPort.distanceKm !== undefined &&
      spanishPort.distanceKm <= 250
    ) {
      referenceLocationName = spanishPort.name;
      referenceCoordinates = { lat: spanishPort.lat, lng: spanishPort.lng };

      try {
        tides = await Promise.race([
          fetchAemetTideData(spanishPort),
          new Promise<TideEvent[] | null>((resolve) =>
            setTimeout(() => resolve(null), 10000),
          ),
        ]);
      } catch (error) {
        console.warn("Error obteniendo datos de AEMET:", error);
        sourceError = "AEMET no respondió";
      }

      if (tides && tides.length > 0) {
        dataSource = "AEMET (predicción marítima)";
        name = spanishPort.name;
        lat = spanishPort.lat;
        lng = spanishPort.lng;
      }
    }

    if (!tides || tides.length === 0) {
      tides = calculateApproximateTides(lat, lng, new Date());
      isApproximate = true;
      dataSource = dataSource || "Estimación local aproximada";
      dataDisclaimer =
        dataDisclaimer ||
        "Mostramos mareas aproximadas porque no recibimos respuesta de las fuentes oficiales en este entorno.";
      if (!sourceError) {
        sourceError = "Fuentes oficiales sin respuesta";
      }
    }

    const { height: currentHeight, isRising } = calculateCurrentHeight(tides);
    const chartData = generateTideCurve(tides);

    const heights = tides.map((t) => t.height);
    const range = Math.max(...heights) - Math.min(...heights);
    const coefficient = Math.min(
      120,
      Math.max(20, Math.round((range / 4) * 100)),
    );

    return {
      requestedName: query,
      locationName: name,
      coordinates: { lat, lng },
      referenceLocationName,
      referenceCoordinates,
      requestedCoordinates,
      date: new Date().toLocaleDateString("es-ES"),
      coefficient,
      sun,
      tides: tides.sort((a, b) => a.time.localeCompare(b.time)),
      currentHeight,
      isRising,
      chartData,
      dataSource,
      dataDisclaimer,
      isApproximate,
      sourceError,
    };
  } catch (error) {
    console.error("Error general obteniendo mareas:", error);
    const chartData = generateTideCurve(MOCK_TIDE_DATA.tides as TideEvent[]);
    return {
      ...MOCK_TIDE_DATA,
      requestedName: query || "Vigo",
      referenceLocationName: `${query || "Vigo"} (simulado)`,
      locationName: `${query || "Vigo"} (Simulado)`,
      requestedCoordinates: MOCK_TIDE_DATA.coordinates,
      chartData,
      dataSource: "Simulación local",
      dataDisclaimer:
        "Se muestran datos simulados porque no fue posible contactar con las fuentes de datos oficiales.",
      isApproximate: true,
      sourceError: "Error en servicios de mareas",
    } as TideData;
  }
};
