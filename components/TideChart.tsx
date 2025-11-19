import React, { useState, useMemo } from 'react';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine, ReferenceDot, Label } from 'recharts';
import { TideData } from '../types';
import { Sailboat, Sun, Moon } from 'lucide-react';
import { timeToDecimal, decimalToTime } from '../utils/tideMath';

interface TideChartProps {
  data: TideData;
}

// Updated RGB Color definitions for a vibrant horizon glow
const COLORS = {
  NIGHT: [2, 4, 10],       // #02040a (Deep Dark)
  BLUE: [30, 64, 175],     // #1e40af (Blue-800 - Deep Blue Hour)
  GOLD: [249, 115, 22],    // #f97316 (Orange-500 - Golden Hour/Sunset)
  DAY: [14, 165, 233],     // #0ea5e9 (Sky-500 - Daylight Blue)
};

// Helper: Interpolate between two RGB arrays
const interpolateColor = (c1: number[], c2: number[], factor: number) => {
  const f = Math.max(0, Math.min(1, factor));
  const r = Math.round(c1[0] + (c2[0] - c1[0]) * f);
  const g = Math.round(c1[1] + (c2[1] - c1[1]) * f);
  const b = Math.round(c1[2] + (c2[2] - c1[2]) * f);
  return `rgb(${r}, ${g}, ${b})`;
};

// Helper: Calculate horizon color based on time
const getSkyColor = (time: number, sunrise: number, sunset: number): string => {
  let t = time;
  while (t < 0) t += 24;
  while (t >= 24) t -= 24;

  const { NIGHT, BLUE, GOLD, DAY } = COLORS;

  // --- MORNING ---
  // Night -> Blue (starts 1.5h before sunrise)
  if (t < sunrise - 1.5) return `rgb(${NIGHT.join(',')})`;
  if (t < sunrise - 0.5) return interpolateColor(NIGHT, BLUE, (t - (sunrise - 1.5)) / 1);
  
  // Blue -> Gold (starts 30m before sunrise)
  if (t < sunrise) return interpolateColor(BLUE, GOLD, (t - (sunrise - 0.5)) / 0.5);
  
  // Gold -> Day (starts at sunrise, lasts 1h)
  if (t < sunrise + 1) return interpolateColor(GOLD, DAY, (t - sunrise) / 1);
  
  // --- DAY ---
  if (t < sunset - 1) return `rgb(${DAY.join(',')})`;

  // --- EVENING ---
  // Day -> Gold (starts 1h before sunset)
  if (t < sunset) return interpolateColor(DAY, GOLD, (t - (sunset - 1)) / 1);
  
  // Gold -> Blue (starts at sunset, lasts 45m)
  if (t < sunset + 0.75) return interpolateColor(GOLD, BLUE, (t - sunset) / 0.75);
  
  // Blue -> Night (starts 45m after sunset, lasts 1h)
  if (t < sunset + 1.75) return interpolateColor(BLUE, NIGHT, (t - (sunset + 0.75)) / 1);

  // Night
  return `rgb(${NIGHT.join(',')})`;
};

export const TideChart: React.FC<TideChartProps> = ({ data }) => {
  const currentTime = new Date();
  const currentDecimal = currentTime.getHours() + currentTime.getMinutes() / 60;
  
  const [hoverTime, setHoverTime] = useState(currentDecimal);
  
  const sunriseDecimal = timeToDecimal(data.sun.sunrise);
  const sunsetDecimal = timeToDecimal(data.sun.sunset);

  // Calculate the dynamic horizon color
  const horizonColor = useMemo(() => 
    getSkyColor(hoverTime, sunriseDecimal, sunsetDecimal),
  [hoverTime, sunriseDecimal, sunsetDecimal]);

  // Determine celestial icon
  const isDay = hoverTime > sunriseDecimal && hoverTime < sunsetDecimal;

  // Find next tides
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
      className="w-full h-64 md:h-80 relative overflow-hidden"
      style={{ 
        background: `linear-gradient(to top, ${horizonColor} 0%, #02040a 60%)`
      }}
    >
      {/* Celestial Body Decoration */}
      <div className="absolute top-4 right-4 transition-opacity duration-1000 opacity-80 pointer-events-none">
        {isDay ? (
          <Sun className="text-yellow-400 animate-pulse" size={24} />
        ) : (
          <Moon className="text-blue-200" size={24} />
        )}
      </div>

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

          {/* Reference lines for Sun/Time */}
          <ReferenceLine x={sunriseDecimal} stroke="#FACC15" strokeDasharray="3 3" strokeWidth={2}>
            <Label value="Salida" position="insideTopLeft" fill="#FACC15" fontSize={10} offset={10} className="hidden sm:block" />
          </ReferenceLine>
          
          <ReferenceLine x={sunsetDecimal} stroke="#A855F7" strokeDasharray="3 3" strokeWidth={2}>
             <Label value="Puesta" position="insideTopRight" fill="#A855F7" fontSize={10} offset={10} className="hidden sm:block" />
          </ReferenceLine>
          
          <ReferenceLine x={currentDecimal} stroke="#FFFFFF" strokeWidth={2} />

          {/* Tide Heights */}
          {nextHigh && (
            <ReferenceLine y={nextHigh.height} stroke="#22C55E" strokeDasharray="5 5" strokeOpacity={0.7}>
              <Label value={`Pleamar ${nextHigh.height}m`} position="insideRight" fill="#22C55E" fontSize={10} dy={-10} />
            </ReferenceLine>
          )}

          {nextLow && (
            <ReferenceLine y={nextLow.height} stroke="#EF4444" strokeDasharray="5 5" strokeOpacity={0.7}>
              <Label value={`Bajamar ${nextLow.height}m`} position="insideRight" fill="#EF4444" fontSize={10} dy={10} />
            </ReferenceLine>
          )}
          
          <ReferenceLine y={data.currentHeight} stroke="white" strokeDasharray="2 4" strokeOpacity={0.5} />

          <Area
            type="monotone"
            dataKey="height"
            stroke="#3b82f6"
            strokeWidth={3}
            fill="url(#colorHeight)"
            animationDuration={1500}
          />
          
          <ReferenceDot 
            x={currentDecimal} 
            y={data.currentHeight} 
            r={0}
            shape={renderBoat}
          />
        </AreaChart>
      </ResponsiveContainer>
      
      <div className="absolute top-2 right-2 flex flex-col items-end gap-1 text-[10px] text-gray-400 pointer-events-none opacity-80">
        <div className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-yellow-400"></span> Sol</div>
        <div className="flex items-center gap-1"><span className="w-2 h-0.5 bg-white"></span> Ahora</div>
        <div className="mt-1 text-[9px] opacity-70">Mueve el cursor para ver el color del cielo</div>
      </div>
    </div>
  );
};
