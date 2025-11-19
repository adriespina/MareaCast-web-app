
import { TideEvent } from '../types';

/**
 * Helper to convert HH:MM to decimal hours
 */
export const timeToDecimal = (time: string): number => {
  const [h, m] = time.split(':').map(Number);
  return h + m / 60;
};

/**
 * Helper to format decimal hours back to HH:MM
 */
export const decimalToTime = (decimal: number): string => {
  let d = decimal;
  while (d < 0) d += 24;
  while (d >= 24) d -= 24;
  
  const h = Math.floor(d);
  const m = Math.round((d - h) * 60);
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
};

/**
 * Calculates the estimated height of the tide at a specific decimal time
 * by interpolating between the surrounding tide events.
 */
const getTideHeightAtTime = (timeDecimal: number, tides: TideEvent[]): number => {
  if (tides.length === 0) return 0;

  const sortedTides = [...tides].sort((a, b) => timeToDecimal(a.time) - timeToDecimal(b.time));
  
  let t1: number, h1: number, t2: number, h2: number;

  // Identify the bounding tide events
  if (timeDecimal <= timeToDecimal(sortedTides[0].time)) {
    // Time is before the first tide of the day.
    // Extrapolate a virtual previous tide ~6.21h before the first one.
    const first = sortedTides[0];
    t2 = timeToDecimal(first.time);
    h2 = first.height;
    
    t1 = t2 - 6.21;
    // Estimate previous height: if first is High, prev was Low (approx -amplitude)
    // We use a heuristic amplitude of ~2.5m difference if actual data isn't available
    h1 = first.type === 'HIGH' ? Math.max(0, h2 - 2.5) : h2 + 2.5; 
    
  } else if (timeDecimal >= timeToDecimal(sortedTides[sortedTides.length - 1].time)) {
    // Time is after the last tide of the day.
    // Extrapolate a virtual next tide.
    const last = sortedTides[sortedTides.length - 1];
    t1 = timeToDecimal(last.time);
    h1 = last.height;
    
    t2 = t1 + 6.21;
    h2 = last.type === 'HIGH' ? Math.max(0, h1 - 2.5) : h1 + 2.5;

  } else {
    // Time is strictly between two tides today
    let idx = 0;
    for (let i = 0; i < sortedTides.length - 1; i++) {
      if (timeDecimal >= timeToDecimal(sortedTides[i].time) && timeDecimal <= timeToDecimal(sortedTides[i+1].time)) {
        idx = i;
        break;
      }
    }
    const start = sortedTides[idx];
    const end = sortedTides[idx+1];
    t1 = timeToDecimal(start.time);
    h1 = start.height;
    t2 = timeToDecimal(end.time);
    h2 = end.height;
  }

  // Cosine Interpolation: y = (h1+h2)/2 + (h1-h2)/2 * cos(pi * (t-t1)/(t2-t1))
  const duration = t2 - t1;
  const t = timeDecimal;
  const angle = Math.PI * (t - t1) / duration;
  const height = (h1 + h2) / 2 + ((h1 - h2) / 2) * Math.cos(angle);

  return Number(height.toFixed(2));
};

/**
 * Generates points for the entire 24h cycle (00:00 to 24:00)
 */
export const generateTideCurve = (tides: TideEvent[]): { time: number; height: number; label?: string }[] => {
  if (tides.length < 2) return [];

  const points: { time: number; height: number; label?: string }[] = [];
  
  // Generate a point every 15 minutes (0.25 hours)
  for (let t = 0; t <= 24; t += 0.25) {
    const height = getTideHeightAtTime(t, tides);
    points.push({
      time: t,
      height
    });
  }

  return points;
};

/**
 * Calculates current height based on current time and tide schedule
 */
export const calculateCurrentHeight = (tides: TideEvent[]): { height: number; isRising: boolean } => {
  const now = new Date();
  const currentDecimal = now.getHours() + now.getMinutes() / 60;
  
  const hNow = getTideHeightAtTime(currentDecimal, tides);
  // Look slightly ahead (1 min = ~0.016h) to check slope
  const hNext = getTideHeightAtTime(currentDecimal + 0.02, tides);
  
  return { height: hNow, isRising: hNext > hNow };
};
