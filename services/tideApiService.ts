import { TideData, TideEvent } from "../types";
import {
  calculateCurrentHeight,
  generateTideCurve,
  getHaversineDistance,
} from "../utils/tideMath";

const IDEIHM_PORTS_URL = "/ihm-ports.json"; // Servido desde /public
const IDEIHM_BASE_URL = "https://ideihm.covam.es/api-ihm/getmarea";
const DEFAULT_COORDS = { lat: 42.2406, lng: -8.7206, name: "Vigo" };

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

type IhmPort = {
  id: string;
  code: string;
  puerto: string;
  lat: number;
  lon: number;
};

type IhmPortsResponse = {
  estaciones?: {
    puertos?: Array<{
      id: string;
      code: string;
      puerto: string;
      lat: string;
      lon: string;
    }>;
  };
};

type IhmTideResponse = {
  mareas?: {
    puerto?: string;
    fecha?: string;
    lat?: string;
    lon?: string;
    datos?: {
      marea?: Array<{
        hora?: string;
        altura?: string;
        tipo?: string;
      }>;
    };
  };
};

const normalize = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();

let portCache: IhmPort[] | null = null;

async function loadPorts(): Promise<IhmPort[]> {
  if (portCache) return portCache;
  try {
    const response = await fetch(IDEIHM_PORTS_URL);
    if (!response.ok)
      throw new Error("No se pudo descargar la lista de puertos IHM");
    const payload = (await response.json()) as IhmPortsResponse;
    const puertos = payload.estaciones?.puertos || [];
    portCache = puertos
      .map((p) => ({
        id: p.id,
        code: p.code,
        puerto: p.puerto,
        lat: Number(p.lat),
        lon: Number(p.lon),
      }))
      .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon));
    return portCache;
  } catch (error) {
    console.error("Error cargando puertos IHM:", error);
    return [];
  }
}

function findPortByName(query: string, ports: IhmPort[]): IhmPort | null {
  const normalizedQuery = normalize(query);
  return (
    ports.find(
      (port) =>
        normalizedQuery === normalize(port.code) ||
        normalizedQuery === normalize(port.puerto),
    ) ||
    ports.find(
      (port) =>
        normalize(port.puerto).includes(normalizedQuery) ||
        normalizedQuery.includes(normalize(port.puerto)),
    ) ||
    null
  );
}

function findNearestPort(
  lat: number,
  lon: number,
  ports: IhmPort[],
): { port: IhmPort; distanceKm: number } | null {
  let closest: { port: IhmPort; distanceKm: number } | null = null;
  for (const port of ports) {
    const distanceKm = getHaversineDistance(lat, lon, port.lat, port.lon);
    if (!closest || distanceKm < closest.distanceKm) {
      closest = { port, distanceKm };
    }
  }
  return closest;
}

function parseIhmTides(
  data: IhmTideResponse,
): {
  tides: TideEvent[];
  portName?: string;
  coords?: { lat: number; lng: number };
} | null {
  const mareaEntries = data.mareas?.datos?.marea;
  if (!mareaEntries || mareaEntries.length === 0) return null;

  const tides: TideEvent[] = [];
  for (const entry of mareaEntries) {
    if (!entry?.hora || !entry?.altura || !entry?.tipo) continue;
    const height = Number(entry.altura.replace(",", "."));
    if (Number.isNaN(height)) continue;
    const type =
      normalize(entry.tipo).includes("plea") ||
      normalize(entry.tipo).includes("alta")
        ? "HIGH"
        : "LOW";
    tides.push({ time: entry.hora, height: Number(height.toFixed(2)), type });
  }

  if (tides.length === 0) return null;

  const lat = data.mareas?.lat ? Number(data.mareas.lat) : undefined;
  const lon = data.mareas?.lon ? Number(data.mareas.lon) : undefined;

  return {
    tides: tides.sort((a, b) => a.time.localeCompare(b.time)),
    portName: data.mareas?.puerto || undefined,
    coords:
      Number.isFinite(lat) && Number.isFinite(lon)
        ? { lat: lat!, lng: lon! }
        : undefined,
  };
}

async function fetchIhmTides(
  portId: string,
  date: Date,
): Promise<{
  tides: TideEvent[] | null;
  portName?: string;
  coords?: { lat: number; lng: number };
}> {
  const dateStr = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}${String(date.getDate()).padStart(2, "0")}`;
  const url = `${IDEIHM_BASE_URL}?request=gettide&id=${encodeURIComponent(portId)}&format=json&date=${dateStr}`;

  try {
    const response = await fetch(url);
    if (!response.ok)
      throw new Error(`Fallo consultando mareas IHM (${response.status})`);
    const payload = (await response.json()) as IhmTideResponse;
    const parsed = parseIhmTides(payload);
    return {
      tides: parsed?.tides || null,
      portName: parsed?.portName,
      coords: parsed?.coords,
    };
  } catch (error) {
    console.error("Error consultando API de IHM:", error);
    return { tides: null };
  }
}

/**
 * Geocodifica un nombre o coordenadas con Nominatim.
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
 * Estimación simple en caso de no disponer de datos oficiales.
 */
function formatTime(minutesTotal: number): string {
  const minutesNormalized = ((minutesTotal % (24 * 60)) + 24 * 60) % (24 * 60);
  const hours = Math.floor(minutesNormalized / 60);
  const minutes = minutesNormalized % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function calculateApproximateTides(lat: number, lng: number): TideEvent[] {
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
 * Función principal: consulta mareas de IHM y, si no, aproxima.
 */
export const fetchTideData = async (
  locationQuery: string,
): Promise<TideData> => {
  const query = locationQuery?.trim() || DEFAULT_COORDS.name;

  try {
    // 1) Geocodificar
    let geoData = await geocodeLocation(query);
    if (!geoData) {
      console.warn(
        "Geocodificación falló, usando coordenadas por defecto (Vigo).",
      );
      geoData = DEFAULT_COORDS;
    }
    let { lat, lng, name } = geoData;
    const requestedCoordinates = { lat, lng };

    // 2) Cargar puertos IHM
    const ports = await loadPorts();
    if (ports.length === 0) {
      throw new Error("No se pudo cargar la lista de puertos del IHM");
    }

    // 3) Seleccionar puerto: coincidencia por nombre o el más cercano
    const matchedPort = findPortByName(name, ports);
    const nearestPort = findNearestPort(lat, lng, ports);
    let selected: { port: IhmPort; distanceKm?: number } | null = null;

    if (matchedPort) {
      selected = {
        port: matchedPort,
        distanceKm: getHaversineDistance(
          lat,
          lng,
          matchedPort.lat,
          matchedPort.lon,
        ),
      };
    } else if (nearestPort) {
      selected = nearestPort;
    }

    let tides: TideEvent[] | null = null;
    let dataSource = "";
    let dataDisclaimer: string | undefined;
    let referenceLocationName: string | undefined;
    let referenceCoordinates: { lat: number; lng: number } | undefined;
    let sourceError: string | undefined;

    if (selected) {
      const { port, distanceKm } = selected;
      referenceLocationName = port.puerto;
      referenceCoordinates = { lat: port.lat, lng: port.lon };

      const {
        tides: ihmTides,
        portName,
        coords,
      } = await fetchIhmTides(port.id, new Date());
      if (ihmTides && ihmTides.length > 0) {
        tides = ihmTides;
        name = portName || port.puerto;
        dataSource = "IHM (API ideihm)";
        if (!matchedPort && distanceKm !== undefined) {
          dataDisclaimer = `Usamos el puerto más cercano (${port.puerto}, a ${distanceKm.toFixed(
            1,
          )} km) porque la ubicación solicitada no tiene estación IHM.`;
        }
        if (coords) {
          lat = coords.lat;
          lng = coords.lng;
        }
      } else {
        sourceError = "IHM no devolvió datos";
      }
    }

    // 4) Fallback a estimación local si IHM no responde
    let isApproximate = false;
    if (!tides || tides.length === 0) {
      tides = calculateApproximateTides(lat, lng);
      isApproximate = true;
      dataSource = dataSource || "Estimación local aproximada";
      dataDisclaimer =
        dataDisclaimer ||
        "Mostramos mareas aproximadas porque no obtuvimos respuesta de la API oficial del IHM en este momento.";
    }

    // 5) Calcular métricas derivadas
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
      referenceLocationName,
      coordinates: { lat, lng },
      referenceCoordinates,
      requestedCoordinates,
      date: new Date().toLocaleDateString("es-ES"),
      coefficient,
      sun: { sunrise: "07:00", sunset: "20:00" }, // La API IHM no expone datos solares; mantenemos valores por defecto.
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
        "Se muestran datos simulados porque no fue posible contactar con la API oficial del IHM.",
      isApproximate: true,
      sourceError: "Error en servicios de mareas",
    } as TideData;
  }
};
