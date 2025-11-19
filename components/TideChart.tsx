import React, { useState, useMemo } from 'react';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine, ReferenceDot, Label } from 'recharts';
import { TideData } from '../types';
import { Sailboat } from 'lucide-react';
import { timeToDecimal, decimalToTime } from '../utils/tideMath';

interface TideChartProps {
  data: TideData;
}

// RGB Color definitions for the sky states
const COLORS = {
  NIGHT: [2, 4, 10],      // #02040a (Rich Black/Blue)
  BLUE: [30, 58, 138],    // #1e3a8a (Blue-900)
  GOLD: [234, 88, 12],    // #ea580c (Orange-600)
  DAY: [12, 74, 110],     // #0c4a6e (Sky-900)
};

/**
 * Interpolates between two RGB arrays based on a factor (0 to 1)
 */
const interpolateColor = (c1: number[], c2: number[], factor: number) => {
  const f = Math.max(0, Math.min(1, factor));
  const r = Math.round(c1[0] + (c2[0] - c1[0]) * f);
  const g = Math.round(c1[1] + (c2[1] - c1[1]) * f);
  const b = Math.round(c1[2] + (c2[2] - c1[2]) * f);
  return `rgb(${r}, ${g}, ${b})`;
};

/**
 * Calculates the sky color for a given time of day
 */
const getSkyColor = (time: number, sunrise: number, sunset: number): string => {
  // Normalize time to 0-24
  let t = time;
  while (t < 0) t += 24;
  while (t >= 24) t -= 24;

  const { NIGHT, BLUE, GOLD, DAY } = COLORS;

  // --- MORNING TRANSITIONS ---
  // Night until Sunrise - 1h
  if (t < sunrise - 1) return `rgb(${NIGHT.join(',')})`;
  
  // Night -> Blue (30m duration)
  if (t < sunrise - 0.5) {
    return interpolateColor(NIGHT, BLUE, (t - (sunrise - 1)) / 0.5);
  }
  
  // Blue -> Gold (30m duration, ends at sunrise)
  if (t < sunrise) {
    return interpolateColor(BLUE, GOLD, (t - (sunrise - 0.5)) / 0.5);
  }
  
  // Gold -> Day (1h duration, ends 1h after sunrise)
  if (t < sunrise + 1) {
    return interpolateColor(GOLD, DAY, (t - sunrise) / 1);
  }
  
  // --- DAY ---
  if (t < sunset - 1) return `rgb(${DAY.join(',')})`;

  // --- EVENING TRANSITIONS ---
  // Day -> Gold (1h duration, starts 1h before sunset)
  if (t < sunset) {
    return interpolateColor(DAY, GOLD, (t - (sunset - 1)) / 1);
  }
  
  // Gold -> Blue (30m duration, starts at sunset)
  if (t < sunset + 0.5) {
    return interpolateColor(GOLD, BLUE, (t - sunset) / 0.5);
  }
  
  // Blue -> Night (1h duration, starts 30m after sunset)
  if (t < sunset + 1.5) {
    return interpolateColor(BLUE, NIGHT, (t - (sunset + 0.5)) / 1);
  }

  // Night
  return `rgb(${NIGHT.join(',')})`;
};

export const TideChart: React.FC<TideChartProps> = ({ data }) => {
  const currentTime = new Date();
  const currentDecimal = currentTime.getHours() + currentTime.getMinutes() / 60;
  
  // Initialize hover time to current time
  const [hoverTime, setHoverTime] = useState(currentDecimal);
  
  // Calculate decimals for sun events
  const sunriseDecimal = timeToDecimal(data.sun.sunrise);
  const sunsetDecimal = timeToDecimal(data.sun.sunset);

  // Calculate dynamic background color
  const backgroundColor = useMemo(() => 
    getSkyColor(hoverTime, sunriseDecimal, sunsetDecimal),
  [hoverTime, sunriseDecimal, sunsetDecimal]);

  // Determine next High and Low tides relative to now for the horizontal lines
  const nextHigh = data.tides
    .filter(t => t.type === 'HIGH' && timeToDecimal(t.time) > currentDecimal)
    .sort((a, b) => timeToDecimal(a.time) - timeToDecimal(b.time))[0] 
    || data.tides.find(t => t.type === 'HIGH'); 

  const nextLow = data.tides
    .filter(t => t.type === 'LOW' && timeToDecimal(t.time) > currentDecimal)
    .sort((a, b) => timeToDecimal(a.time) - timeToDecimal(b.time))[0]
    || data.tides.find(t => t.type === 'LOW');

  const renderBoat = (props: any) => {
    const { cx, cy } = props;
    if (!Number.isFinite(cx) || !Number.isFinite(cy)) return null;
    return (
      <g transform={`translate(${cx - 12},${cy - 24})`}>
        <Sailboat size={24} color="white" fill="white" fillOpacity={0.2} strokeWidth={1.5} />
      </g>
    );
  };

  return (
    <div 
      className="w-full h-64 md:h-80 relative transition-colors duration-150 ease-out"
      style={{ backgroundColor }}
    >
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart
          data={data.chartData}
          margin={{ top: 20, right: 10, left: 0, bottom: 0 }}
          onMouseMove={(e) => {
            if (e && e.activeLabel != null) {
              setHoverTime(Number(e.activeLabel));
            }
          }}
          onMouseLeave={() => {
            setHoverTime(currentDecimal);
          }}
        >
          <defs>
            <linearGradient id="colorHeight" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.8}/>
              <stop offset="95%" stopColor="#0f2b66" stopOpacity={0.9}/>
            </linearGradient>
          </defs>
          
          <XAxis 
            dataKey="time" 
            type="number"
            domain={[0, 24]}
            tickFormatter={(val) => decimalToTime(val)}
            tick={{ fill: '#9ca3af', fontSize: 12 }}
            interval="preserveStartEnd"
            tickCount={9}
            axisLine={false}
            tickLine={false}
          />
          
          <YAxis 
            hide={true} 
            domain={['dataMin - 0.5', 'dataMax + 0.5']}
          />
          
          <Tooltip 
            labelFormatter={(label) => decimalToTime(label as number)}
            contentStyle={{ backgroundColor: '#051026', borderColor: '#1e5bbf', color: 'white' }}
            itemStyle={{ color: '#3b82f6' }}
            formatter={(value: number) => [`${value}m`, 'Altura']}
          />

          {/* === VERTICAL BARS === */}
          
          {/* Sunrise */}
          <ReferenceLine x={sunriseDecimal} stroke="#FACC15" strokeDasharray="3 3" strokeWidth={2}>
            <Label value="Salida" position="insideTopLeft" fill="#FACC15" fontSize={10} offset={10} className="hidden sm:block" />
          </ReferenceLine>
          
          {/* Sunset */}
          <ReferenceLine x={sunsetDecimal} stroke="#A855F7" strokeDasharray="3 3" strokeWidth={2}>
             <Label value="Puesta" position="insideTopRight" fill="#A855F7" fontSize={10} offset={10} className="hidden sm:block" />
          </ReferenceLine>
          
          {/* Current Time */}
          <ReferenceLine x={currentDecimal} stroke="#FFFFFF" strokeWidth={2} />

          {/* === HORIZONTAL BARS === */}
          
          {/* Next High Tide Level */}
          {nextHigh && (
            <ReferenceLine y={nextHigh.height} stroke="#22C55E" strokeDasharray="5 5" strokeOpacity={0.7}>
              <Label value={`Pleamar ${nextHigh.height}m`} position="insideRight" fill="#22C55E" fontSize={10} dy={-10} />
            </ReferenceLine>
          )}

          {/* Next Low Tide Level */}
          {nextLow && (
            <ReferenceLine y={nextLow.height} stroke="#EF4444" strokeDasharray="5 5" strokeOpacity={0.7}>
              <Label value={`Bajamar ${nextLow.height}m`} position="insideRight" fill="#EF4444" fontSize={10} dy={10} />
            </ReferenceLine>
          )}
          
          {/* Current Height Level */}
          <ReferenceLine y={data.currentHeight} stroke="white" strokeDasharray="2 4" strokeOpacity={0.5} />

          <Area
            type="monotone"
            dataKey="height"
            stroke="#3b82f6"
            strokeWidth={3}
            fill="url(#colorHeight)"
            animationDuration={1500}
          />
          
          {/* Boat Icon at Current Time */}
          <ReferenceDot 
            x={currentDecimal} 
            y={data.currentHeight} 
            r={0}
            shape={renderBoat}
          />
        </AreaChart>
      </ResponsiveContainer>
      
      {/* Legend Overlay */}
      <div className="absolute top-2 right-2 flex flex-col items-end gap-1 text-[10px] text-gray-400 pointer-events-none opacity-80">
        <div className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-yellow-400"></span> Sol</div>
        <div className="flex items-center gap-1"><span className="w-2 h-0.5 bg-white"></span> Ahora</div>
        <div className="mt-1 text-[9px] opacity-70">Mueve el cursor para ver el color del cielo</div>
      </div>
    </div>
  );
};