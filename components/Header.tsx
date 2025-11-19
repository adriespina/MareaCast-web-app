import React, { useState } from 'react';
import { MapPin, Search, Navigation } from 'lucide-react';

interface HeaderProps {
  locationName: string;
  date: string;
  onSearch: (term: string) => void;
  onLocate: () => void;
  isLoading: boolean;
}

export const Header: React.FC<HeaderProps> = ({ locationName, date, onSearch, onLocate, isLoading }) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [isSearchOpen, setIsSearchOpen] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchTerm.trim()) {
      onSearch(searchTerm);
      setIsSearchOpen(false);
      setSearchTerm('');
    }
  };

  return (
    <header className="bg-ocean-900 border-b border-ocean-700 text-white p-4 sticky top-0 z-50 shadow-2xl">
      <div className="max-w-7xl mx-auto flex justify-between items-center">
        
        <div className="flex flex-col">
          <h1 className="text-xl font-bold flex items-center gap-2">
            {locationName}
            {isLoading && <span className="text-xs text-blue-400 animate-pulse">Actualizando...</span>}
          </h1>
          <span className="text-sm text-gray-400 font-mono">{date}</span>
        </div>

        <div className="flex items-center gap-3">
          {isSearchOpen ? (
            <form onSubmit={handleSubmit} className="flex items-center gap-2 animate-fade-in">
              <input 
                type="text" 
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Ciudad..."
                className="bg-ocean-800 border border-ocean-600 rounded px-3 py-1 text-sm focus:outline-none focus:border-blue-500 w-40 sm:w-64"
                autoFocus
              />
              <button type="submit" className="bg-blue-600 px-3 py-1 rounded text-sm hover:bg-blue-500">Ir</button>
              <button type="button" onClick={() => setIsSearchOpen(false)} className="text-gray-400 hover:text-white text-xs">X</button>
            </form>
          ) : (
            <>
               <button 
                onClick={() => setIsSearchOpen(true)}
                className="p-2 rounded-full hover:bg-ocean-800 transition-colors"
                title="Buscar ubicación"
              >
                <Search size={20} className="text-blue-300" />
              </button>
              <button 
                onClick={onLocate}
                className="p-2 rounded-full hover:bg-ocean-800 transition-colors"
                title="Usar mi ubicación"
              >
                <Navigation size={20} className="text-blue-300" />
              </button>
            </>
          )}
        </div>
      </div>
    </header>
  );
};
