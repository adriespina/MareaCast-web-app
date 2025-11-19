import { TideData, TideEvent } from "../types";
import { generateTideCurve, calculateCurrentHeight } from "../utils/tideMath";

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
    
    const { lat, lng, name } = geoData;
    
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
    
    // Paso 3: Intentar obtener datos de mareas desde API
    let tides: TideEvent[] | null = null;
    try {
      tides = await Promise.race([
        getTideDataFromAPI(lat, lng),
        new Promise<TideEvent[] | null>((resolve) => setTimeout(() => resolve(null), 8000))
      ]);
    } catch (error) {
      console.warn('Error obteniendo datos de API de mareas:', error);
    }
    
    // Si no hay API key o falla, usar cálculo aproximado
    if (!tides || tides.length === 0) {
      console.warn('No se pudieron obtener datos de API, usando cálculo aproximado');
      const today = new Date();
      tides = calculateApproximateTides(lat, lng, today);
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
    
    return {
      requestedName: locationQuery,
      locationName: name,
      coordinates: { lat, lng },
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
      locationName: `${locationQuery || "Vigo"} (Simulado)`, 
      chartData 
    } as TideData;
  }
};

