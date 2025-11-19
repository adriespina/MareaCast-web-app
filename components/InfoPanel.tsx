import React from 'react';
import { TideData } from '../types';
import { ArrowUp, ArrowDown, Sunrise, Sunset, Waves } from 'lucide-react';

interface InfoPanelProps {
  data: TideData;
}

export const InfoPanel: React.FC<InfoPanelProps> = ({ data }) => {
  return (
    <div className="flex flex-col h-full justify-between p-4 bg-ocean-800/50 border-r border-ocean-600/30 backdrop-blur-sm">
      
      {/* Sun & Coef Header Block */}
      <div className="space-y-4">
        <div className="bg-ocean-700/50 rounded-lg p-3 border border-ocean-600">
          <div className="flex items-center justify-between mb-2 text-blue-200">
            <div className="flex items-center gap-2">
               <Sunrise size={18} className="text-yellow-400" />
               <span className="text-sm font-mono">{data.sun.sunrise}</span>
            </div>
            <div className="text-xs text-blue-400">→</div>
            <div className="flex items-center gap-2">
               <span className="text-sm font-mono">{data.sun.sunset}</span>
               <Sunset size={18} className="text-orange-400" />
            </div>
          </div>
          <div className="flex items-center gap-2 text-cyan-300 font-semibold text-sm border-t border-ocean-600 pt-2">
            <Waves size={16} />
            <span>Coef: {data.coefficient}</span>
          </div>
        </div>
      </div>

      {/* Main Stats: Current Height & Direction */}
      <div className="flex-1 flex flex-col justify-center items-center py-8 relative">
        {/* Ruler Lines Background Effect */}
        <div className="absolute inset-0 flex flex-col justify-between opacity-20 pointer-events-none py-12 px-8">
           {[4, 3, 2, 1, 0].map(level => (
             <div key={level} className="w-full border-t border-dashed border-white text-xs text-right pr-2">{level}m</div>
           ))}
        </div>

        <div className="relative z-10 text-center">
          <div className={`transition-transform duration-700 ${data.isRising ? '-translate-y-2' : 'translate-y-2'}`}>
            {data.isRising ? (
              <ArrowUp size={120} className="text-green-500 drop-shadow-[0_0_10px_rgba(34,197,94,0.5)] animate-pulse" strokeWidth={1.5} />
            ) : (
              <ArrowDown size={120} className="text-red-500 drop-shadow-[0_0_10px_rgba(239,68,68,0.5)] animate-pulse" strokeWidth={1.5} />
            )}
          </div>
          <div className="text-6xl font-bold text-white font-mono tracking-tighter mt-2 drop-shadow-xl">
            {data.currentHeight.toFixed(2)}<span className="text-2xl text-blue-400 ml-1">m</span>
          </div>
          <div className={`text-lg font-bold mt-2 uppercase tracking-widest ${data.isRising ? 'text-green-400' : 'text-red-400'}`}>
            {data.isRising ? 'Subiendo' : 'Bajando'}
          </div>
        </div>
      </div>

      {/* Next Tide Quick View */}
      <div className="mt-auto">
         {/* Space filler if needed */}
      </div>
    </div>
  );
};
