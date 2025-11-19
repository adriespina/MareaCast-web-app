
import React from 'react';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine, ReferenceDot, Label } from 'recharts';
import { TideData } from '../types';
import { Sailboat } from 'lucide-react';
import { timeToDecimal, decimalToTime } from '../utils/tideMath';

interface TideChartProps {
  data: TideData;
}

export const TideChart: React.FC<TideChartProps> = ({ data }) => {
  const currentTime = new Date();
  const currentDecimal = currentTime.getHours() + currentTime.getMinutes() / 60;
  
  // Calculate decimals for sun events
  const sunriseDecimal = timeToDecimal(data.sun.sunrise);
  const sunsetDecimal = timeToDecimal(data.sun.sunset);

  // Determine next High and Low tides relative to now for the horizontal lines
  // If no next high today, use the last one (or first one) as reference
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
    // If cy is invalid (e.g. chart not ready), don't render
    if (!Number.isFinite(cx) || !Number.isFinite(cy)) return null;
    
    return (
      <g transform={`translate(${cx - 12},${cy - 24})`}>
        <Sailboat size={24} color="white" fill="white" fillOpacity={0.2} strokeWidth={1.5} />
      </g>
    );
  };

  return (
    <div className="w-full h-64 md:h-80 relative">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart
          data={data.chartData}
          margin={{ top: 20, right: 10, left: 0, bottom: 0 }}
        >
          <defs>
            <linearGradient id="colorHeight" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3}/>
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
            tickCount={9} // Show roughly every 3 hours
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
          
          {/* Current Time - Solid White Thick Line */}
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
          
          {/* Current Height Level - White Dotted */}
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
            r={0} // Hidden circle, just using shape
            shape={renderBoat}
          />
        </AreaChart>
      </ResponsiveContainer>
      
      {/* Mobile Legend Overlay */}
      <div className="absolute top-2 right-2 flex flex-col items-end gap-1 text-[10px] text-gray-400 pointer-events-none opacity-80">
        <div className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-yellow-400"></span> Sol</div>
        <div className="flex items-center gap-1"><span className="w-2 h-0.5 bg-white"></span> Ahora</div>
      </div>
    </div>
  );
};
