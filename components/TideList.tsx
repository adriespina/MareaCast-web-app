import React from 'react';
import { TideEvent } from '../types';
import { ArrowUpCircle, ArrowDownCircle } from 'lucide-react';

interface TideListProps {
  tides: TideEvent[];
}

export const TideList: React.FC<TideListProps> = ({ tides }) => {
  const currentTime = new Date();
  const currentHour = currentTime.getHours();
  
  // Find next tide for highlighting
  const [nextTideHour] = tides
    .map(t => parseInt(t.time.split(':')[0]))
    .filter(h => h > currentHour)
    .concat([99]); // Fallback

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-0 border-t border-ocean-600">
      {tides.map((tide, index) => {
        const isNext = parseInt(tide.time.split(':')[0]) === nextTideHour; // Simple logic
        return (
          <div 
            key={index} 
            className={`
              relative flex flex-col items-center justify-center p-4 border-r border-ocean-600/50
              ${isNext ? 'bg-ocean-700/30' : 'bg-transparent'}
            `}
          >
            {isNext && (
               <div className="absolute top-0 left-0 w-full h-1 bg-yellow-500 animate-pulse" />
            )}
            <div className={`text-lg font-bold mb-1 ${tide.type === 'HIGH' ? 'text-blue-200' : 'text-blue-100'}`}>
              {tide.type === 'HIGH' ? 'Pleamar' : 'Bajamar'}
            </div>
            <div className="text-3xl font-mono font-bold text-white">
              {tide.time}
            </div>
            <div className="flex items-center gap-1 mt-2 text-sm text-gray-300">
              {tide.type === 'HIGH' ? (
                <ArrowUpCircle size={16} className="text-blue-400" />
              ) : (
                <ArrowDownCircle size={16} className="text-blue-600" />
              )}
              <span>{tide.height}m</span>
            </div>
            {isNext && <span className="text-xs text-yellow-500 mt-1 uppercase tracking-wider font-bold">Próxima</span>}
          </div>
        );
      })}
    </div>
  );
};
