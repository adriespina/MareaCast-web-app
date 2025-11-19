
import { GoogleGenAI, Type } from "@google/genai";
import { TideData, TideEvent } from "../types";
import { generateTideCurve, calculateCurrentHeight } from "../utils/tideMath";

// Fallback mock data for development or quota limits
const MOCK_TIDE_DATA: Omit<TideData, 'chartData'> = {
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

export const fetchTideData = async (locationQuery: string): Promise<TideData> => {
  const apiKey = process.env.API_KEY;
  
  if (!apiKey) {
    console.warn("No API Key provided. Using mock data.");
    const chartData = generateTideCurve(MOCK_TIDE_DATA.tides);
    return { ...MOCK_TIDE_DATA, chartData };
  }

  const ai = new GoogleGenAI({ apiKey });

  try {
    // Step 1: Use Google Search to find the raw data
    // We ask for specific data points to ensure the model searches for them.
    const searchPrompt = `
      Busca la tabla de mareas completa para hoy en ${locationQuery}. 
      Necesito saber:
      1. Horas y alturas de todas las pleamares y bajamares de hoy.
      2. El coeficiente de marea de hoy.
      3. Hora de salida y puesta del sol hoy.
      4. Las coordenadas geográficas (latitud y longitud) aproximadas de este punto de costa.
    `;

    const searchResponse = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: searchPrompt,
      config: {
        tools: [{ googleSearch: {} }],
      },
    });
    
    const rawText = searchResponse.text;

    // Step 2: Extract structured data from the search result
    // We pass the raw text and ask for a strict JSON format.
    const extractionPrompt = `
      Act as a data extraction engine. Based ONLY on the following text, extract the tide and sun information for today.
      
      Text to analyze:
      ${rawText}
      
      Return a JSON object with this schema:
      {
        "locationName": "string (City Name)",
        "latitude": number,
        "longitude": number,
        "date": "string (DD/MM/YYYY)",
        "coefficient": number (integer),
        "sunrise": "HH:MM",
        "sunset": "HH:MM",
        "tides": [
          { "time": "HH:MM", "height": number (meters), "type": "HIGH" | "LOW" }
        ]
      }
      
      Ensure times are in 24h format. Heights in meters.
    `;

    const extractionResponse = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: extractionPrompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            locationName: { type: Type.STRING },
            latitude: { type: Type.NUMBER },
            longitude: { type: Type.NUMBER },
            date: { type: Type.STRING },
            coefficient: { type: Type.INTEGER },
            sunrise: { type: Type.STRING },
            sunset: { type: Type.STRING },
            tides: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  time: { type: Type.STRING },
                  height: { type: Type.NUMBER },
                  type: { type: Type.STRING, enum: ["HIGH", "LOW"] }
                }
              }
            }
          }
        }
      }
    });

    const jsonString = extractionResponse.text;
    if (!jsonString) throw new Error("Failed to extract JSON");

    const parsedData = JSON.parse(jsonString);

    // Validate and Process
    const tides: TideEvent[] = parsedData.tides || [];
    
    // If API returns minimal data or fails to parse tides properly, throw fallback
    if (tides.length === 0) throw new Error("No tide data found");

    const { height: currentHeight, isRising } = calculateCurrentHeight(tides);
    const chartData = generateTideCurve(tides);

    return {
      locationName: parsedData.locationName || locationQuery,
      coordinates: (parsedData.latitude && parsedData.longitude) ? { lat: parsedData.latitude, lng: parsedData.longitude } : undefined,
      date: parsedData.date || new Date().toLocaleDateString('es-ES'),
      coefficient: parsedData.coefficient || 70, // Default if missing
      sun: {
        sunrise: parsedData.sunrise || "07:00",
        sunset: parsedData.sunset || "20:00"
      },
      tides: tides.sort((a, b) => a.time.localeCompare(b.time)),
      currentHeight,
      isRising,
      chartData
    };

  } catch (error) {
    console.error("Error fetching tide data:", error);
    // Fallback to mock data in case of error (better than empty screen)
    const chartData = generateTideCurve(MOCK_TIDE_DATA.tides as TideEvent[]);
    return { ...MOCK_TIDE_DATA, locationName: `${locationQuery} (Offline/Simulado)`, chartData } as TideData;
  }
};
