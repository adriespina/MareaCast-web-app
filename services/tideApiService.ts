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
 * Geocodifica un nombre de lugar o coordenadas usando Nominatim (OpenStreetMap)
 * API pública y gratuita
 */
async function geocodeLocation(query: string): Promise<{ lat: number; lng: number; name: string } | null> {
  try {
    // Si ya son coordenadas, parsearlas directamente
    const coordMatch = query.match(/^(-?\d+\.?\d*),\s*(-?\d+\.?\d*)$/);
    if (coordMatch) {
      const lat = parseFloat(coordMatch[1]);
      const lng = parseFloat(coordMatch[2]);
      
      // Validar coordenadas
      if (isNaN(lat) || isNaN(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
        return null;
      }
      
      // Hacer reverse geocoding para obtener el nombre (con timeout)
      try {
        const reverseUrl = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=10&addressdetails=1`;
        const reverseResponse = await Promise.race([
          fetch(reverseUrl, {
            headers: {
              'User-Agent': 'MareaCast/1.0'
            }
          }),
          new Promise<Response>((_, reject) => 
            setTimeout(() => reject(new Error('Timeout')), 5000)
          )
        ]);
        
        if (reverseResponse.ok) {
          const reverseData = await reverseResponse.json();
          return {
            lat,
            lng,
            name: reverseData.display_name || `${lat}, ${lng}`
          };
        }
      } catch (error) {
        console.warn('Reverse geocoding failed, using coordinates as name:', error);
      }
      
      return {
        lat,
        lng,
        name: `${lat}, ${lng}`
      };
    }

    // Geocodificación directa (con timeout)
    const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=1&addressdetails=1`;
    const response = await Promise.race([
      fetch(url, {
        headers: {
          'User-Agent': 'MareaCast/1.0' // Requerido por Nominatim
        }
      }),
      new Promise<Response>((_, reject) => 
        setTimeout(() => reject(new Error('Timeout')), 5000)
      )
    ]);
    
    if (!response.ok) throw new Error('Geocoding failed');
    
    const data = await response.json();
    if (!data || data.length === 0) return null;
    
    const result = data[0];
    return {
      lat: parseFloat(result.lat),
      lng: parseFloat(result.lon),
      name: result.display_name || query
    };
  } catch (error) {
    console.error('Geocoding error:', error);
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
 * Obtiene datos de mareas desde tablademareas.com usando proxy CORS
 * Esta fuente usa datos oficiales del IHM
 */
async function getTideDataFromTablademareas(portName: string): Promise<TideEvent[] | null> {
  try {
    // Normalizar el nombre del puerto para la URL
    const normalizedName = portName.toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '') // Eliminar acentos
      .replace(/\s+/g, '-')
      .replace(/[^a-z0-9-]/g, '');
    
    // Intentar acceder a tablademareas.com usando proxy CORS
    // Nota: Esto puede fallar por CORS, en ese caso necesitaríamos un backend proxy
    const url = `https://tablademareas.com/es/${normalizedName}`;
    
    // Usar un proxy CORS público (allorigins.win)
    const proxyUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(url)}`;
    
    const response = await Promise.race([
      fetch(proxyUrl),
      new Promise<Response>((_, reject) => 
        setTimeout(() => reject(new Error('Timeout')), 10000)
      )
    ]);
    
    if (!response.ok) throw new Error('Failed to fetch from tablademareas');
    
    const data = await response.json();
    const html = data.contents;
    
    if (!html) return null;
    
    // Parsear HTML para extraer datos de mareas
    // Buscar patrones comunes en tablademareas.com
    // Formato típico: "HH:MM X.XX m" donde X.XX es la altura
    
    const tides: TideEvent[] = [];
    
    // Buscar patrones de hora y altura
    // Patrón 1: "HH:MM" seguido de un número decimal y "m"
    const pattern1 = /(\d{1,2}):(\d{2})[^\d]*(\d+[,.]\d+)\s*m/gi;
    let match;
    const foundTides: Array<{ time: string; height: number }> = [];
    
    while ((match = pattern1.exec(html)) !== null && foundTides.length < 8) {
      const hours = match[1].padStart(2, '0');
      const minutes = match[2];
      const height = parseFloat(match[3].replace(',', '.'));
      
      if (!isNaN(height) && height > 0 && height < 10) {
        foundTides.push({
          time: `${hours}:${minutes}`,
          height: Math.round(height * 100) / 100
        });
      }
    }
    
    // Si encontramos datos, clasificarlos como HIGH o LOW
    if (foundTides.length >= 2) {
      // Ordenar por hora
      foundTides.sort((a, b) => a.time.localeCompare(b.time));
      
      // Identificar pleamares y bajamares (máximos y mínimos locales)
      for (let i = 0; i < foundTides.length; i++) {
        const prev = i > 0 ? foundTides[i - 1].height : foundTides[foundTides.length - 1].height;
        const curr = foundTides[i].height;
        const next = i < foundTides.length - 1 ? foundTides[i + 1].height : foundTides[0].height;
        
        // Si es un máximo local, es pleamar
        if (curr > prev && curr > next) {
          tides.push({
            time: foundTides[i].time,
            height: curr,
            type: 'HIGH'
          });
        }
        // Si es un mínimo local, es bajamar
        else if (curr < prev && curr < next) {
          tides.push({
            time: foundTides[i].time,
            height: curr,
            type: 'LOW'
          });
        }
      }
      
      // Si no pudimos clasificar, alternar HIGH/LOW
      if (tides.length === 0 && foundTides.length >= 2) {
        tides.push(
          { time: foundTides[0].time, height: foundTides[0].height, type: 'HIGH' },
          { time: foundTides[1].time, height: foundTides[1].height, type: 'LOW' }
        );
        if (foundTides.length >= 3) {
          tides.push({ time: foundTides[2].time, height: foundTides[2].height, type: 'HIGH' });
        }
        if (foundTides.length >= 4) {
          tides.push({ time: foundTides[3].time, height: foundTides[3].height, type: 'LOW' });
        }
      }
    }
    
    return tides.length >= 2 ? tides.sort((a, b) => a.time.localeCompare(b.time)) : null;
  } catch (error) {
    console.error('Error fetching from tablademareas.com:', error);
    return null;
  }
}

/**
 * Obtiene datos de mareas usando WorldTides API (tier gratuito)
 * Alternativa: usa datos calculados si no hay API key
 */
async function getTideDataFromAPI(lat: number, lng: number): Promise<TideEvent[] | null> {
  // En el cliente, las variables de entorno de Vite están disponibles como import.meta.env
  // pero también pueden estar en process.env si se definieron en vite.config.ts
  const apiKey = (import.meta.env?.WORLDTIDES_API_KEY as string) || 
                 (process.env?.WORLDTIDES_API_KEY as string) || 
                 undefined;
  
  if (!apiKey || apiKey === 'undefined' || apiKey === '') {
    // Sin API key, intentar usar datos calculados aproximados
    return null;
  }

  try {
    const today = new Date();
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    
    // Formatear fechas en formato requerido por WorldTides
    const formatDate = (date: Date) => {
      return `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`;
    };
    
    const startDate = formatDate(today);
    const endDate = formatDate(tomorrow);
    
    // WorldTides API - obtener predicciones de mareas
    const url = `https://www.worldtides.info/api/v3?heights&lat=${lat}&lon=${lng}&start=${startDate}&end=${endDate}&key=${apiKey}`;
    
    const response = await fetch(url);
    if (!response.ok) throw new Error('WorldTides API failed');
    
    const data = await response.json();
    
    if (!data.heights || data.heights.length === 0) {
      return null;
    }
    
    // Convertir datos de WorldTides a nuestro formato
    // WorldTides devuelve alturas cada hora, necesitamos encontrar máximos y mínimos
    const heights = data.heights;
    const tides: TideEvent[] = [];
    
    // Encontrar pleamares y bajamares (máximos y mínimos locales)
    for (let i = 1; i < heights.length - 1; i++) {
      const prev = heights[i - 1].height;
      const curr = heights[i].height;
      const next = heights[i + 1].height;
      
      // Máximo local = pleamar
      if (curr > prev && curr > next) {
        const date = new Date(heights[i].dt * 1000);
        const hours = String(date.getHours()).padStart(2, '0');
        const minutes = String(date.getMinutes()).padStart(2, '0');
        tides.push({
          time: `${hours}:${minutes}`,
          height: Math.round(curr * 100) / 100, // Redondear a 2 decimales
          type: 'HIGH'
        });
      }
      
      // Mínimo local = bajamar
      if (curr < prev && curr < next) {
        const date = new Date(heights[i].dt * 1000);
        const hours = String(date.getHours()).padStart(2, '0');
        const minutes = String(date.getMinutes()).padStart(2, '0');
        tides.push({
          time: `${hours}:${minutes}`,
          height: Math.round(curr * 100) / 100,
          type: 'LOW'
        });
      }
    }
    
    return tides.length > 0 ? tides.sort((a, b) => a.time.localeCompare(b.time)) : null;
  } catch (error) {
    console.error('WorldTides API error:', error);
    return null;
  }
}

/**
 * Calcula datos de mareas aproximados usando fórmulas astronómicas
 * Basado en componentes armónicos de marea simplificados
 * Nota: Este es un cálculo aproximado. Para mayor precisión se recomienda usar una API de mareas
 */
function calculateApproximateTides(lat: number, lng: number, date: Date): TideEvent[] {
  // Calcular fase lunar aproximada (0 = luna nueva, 0.5 = luna llena)
  // Usando una aproximación simple basada en días desde una fecha conocida de luna nueva
  const knownNewMoon = new Date('2024-01-11T00:00:00Z'); // Luna nueva conocida
  const daysSinceNewMoon = (date.getTime() - knownNewMoon.getTime()) / (1000 * 60 * 60 * 24);
  const lunarPhase = (daysSinceNewMoon % 29.53059) / 29.53059; // Período lunar sinódico
  
  // Coeficiente de marea basado en fase lunar (0-120)
  // Máximo en luna nueva y luna llena (mareas vivas), mínimo en cuartos (mareas muertas)
  const phaseAngle = lunarPhase * Math.PI * 2;
  const coefficient = 50 + Math.round(70 * Math.abs(Math.sin(phaseAngle)));
  
  // Hora base ajustada por longitud (cada 15 grados = 1 hora de diferencia)
  const localHour = date.getHours() + date.getMinutes() / 60;
  const longitudeOffset = lng / 15; // Ajuste por longitud
  const baseHour = (localHour + longitudeOffset) % 24;
  
  // Período de marea semidiurna (12.42 horas en promedio)
  const tidePeriod = 12.42;
  
  // Altura base según latitud (mareas más grandes cerca de los polos, más pequeñas en el ecuador)
  const latFactor = Math.abs(Math.sin(lat * Math.PI / 180));
  const baseHighHeight = 2.5 + latFactor * 2.0; // Entre 2.5m y 4.5m
  const baseLowHeight = 0.5 + latFactor * 0.5;   // Entre 0.5m y 1.0m
  
  // Variación según coeficiente
  const heightRange = (coefficient / 120) * 2.0; // Rango adicional según coeficiente
  
  const tides: TideEvent[] = [];
  const startHour = baseHour;
  
  // Calcular 4 eventos de marea para el día (2 pleamares, 2 bajamares)
  for (let i = 0; i < 4; i++) {
    const isHigh = i % 2 === 0;
    const eventHour = (startHour + (i * tidePeriod / 2)) % 24;
    
    // Ajuste fino basado en fase lunar para la hora
    const lunarAdjustment = Math.sin(phaseAngle) * 0.5; // Ajuste de hasta ±0.5 horas
    const adjustedHour = (eventHour + lunarAdjustment + 24) % 24;
    
    const hours = Math.floor(adjustedHour);
    const minutes = Math.floor((adjustedHour - hours) * 60);
    
    // Calcular altura
    let height: number;
    if (isHigh) {
      height = baseHighHeight + heightRange;
    } else {
      height = baseLowHeight - heightRange;
    }
    
    // Asegurar que la altura sea positiva y razonable
    height = Math.max(0.1, Math.min(6.0, height));
    
    tides.push({
      time: `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`,
      height: Math.round(height * 100) / 100,
      type: isHigh ? 'HIGH' : 'LOW'
    });
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

      if (allowDirectAemet) {
        try {
          tides = await Promise.race([
            fetchAemetTideData(spanishPort),
            new Promise<TideEvent[] | null>((resolve) => setTimeout(() => resolve(null), 10000))
          ]);
          if (tides && tides.length > 0) {
            dataSource = 'AEMET (predicción marítima)';
          }
        } catch (error: any) {
          console.warn('Error obteniendo datos de AEMET:', error);
          sourceError = 'AEMET no disponible (CORS o red).';
        }
      } else {
        sourceError = 'AEMET requiere un proxy backend por CORS en producción.';
      }

      // Fallback a fuente IHM si AEMET falla
      if ((!tides || tides.length === 0) && allowDirectScrape) {
        try {
          tides = await Promise.race([
            getTideDataFromTablademareas(spanishPort.name),
            new Promise<TideEvent[] | null>((resolve) => setTimeout(() => resolve(null), 10000))
          ]);
          if (tides && tides.length > 0) {
            dataSource = 'tablademareas.com (IHM)';
          }
        } catch (error) {
          console.warn('Error obteniendo datos de tablademareas.com:', error);
        }
      } else if (!allowDirectScrape && (!tides || tides.length === 0)) {
        sourceError = 'Necesitas un proxy para consultar tablademareas.com sin CORS.';
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
      dataSource,
      isApproximate,
      dataDisclaimer,
      sourceError,
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
      dataSource: 'Simulación de respaldo',
      isApproximate: true,
      dataDisclaimer: 'Datos simulados por error en las fuentes oficiales. Configura un proxy AEMET/tablas en producción para obtener datos reales.',
      chartData
    } as TideData;
  }
};

