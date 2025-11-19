import React, { useEffect, useState } from 'react';
import { Header } from './components/Header';
import { InfoPanel } from './components/InfoPanel';
import { TideChart } from './components/TideChart';
import { TideList } from './components/TideList';
import { MapView } from './components/MapView';
import { fetchTideData } from './services/geminiService';
import { TideData } from './types';

const App: React.FC = () => {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<TideData | null>(null);
  const [location, setLocation] = useState<string>("Vigo");

  const loadData = async (loc: string) => {
    setLoading(true);
    try {
      const tideData = await fetchTideData(loc);
      setData(tideData);
    } catch (error) {
      console.error("Failed to load data", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // Initial load
    loadData(location);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSearch = (term: string) => {
    setLocation(term);
    loadData(term);
  };

  const handleLocate = () => {
    if ('geolocation' in navigator) {
      setLoading(true);
      navigator.geolocation.getCurrentPosition(async (position) => {
        const { latitude, longitude } = position.coords;
        // Reverse geocoding via text search logic in geminiService can handle coords too
        // We pass coordinates string, the service will identify it.
        const coordString = `${latitude}, ${longitude}`;
        setLocation("Tu Ubicación");
        loadData(coordString);
      }, (error) => {
        console.error("Geolocation error", error);
        setLoading(false);
        alert("No se pudo obtener la ubicación. Verifica tus permisos.");
      });
    } else {
      alert("Geolocalización no soportada en este navegador.");
    }
  };

  if (!data && !loading) return <div className="min-h-screen bg-black text-white flex items-center justify-center">Error cargando datos.</div>;

  return (
    <div className="min-h-screen bg-ocean-900 text-white font-sans selection:bg-blue-500 selection:text-white flex flex-col">
      {/* Top Bar */}
      <Header 
        locationName={data?.locationName || location} 
        date={data?.date || ""} 
        onSearch={handleSearch}
        onLocate={handleLocate}
        isLoading={loading}
      />

      <main className="flex-1 flex flex-col max-w-5xl mx-auto w-full shadow-2xl bg-ocean-800 overflow-hidden md:my-8 md:rounded-xl border border-ocean-700">
        
        {/* Top Map Strip */}
        <MapView 
          locationName={data?.locationName || location} 
          coordinates={data?.coordinates}
        />

        {/* Main Content Area - Split View */}
        <div className="flex flex-col md:flex-row border-b border-ocean-600 relative">
          
          {/* Left Panel: Key Stats (Big Arrow, Current Height, Sun) */}
          <div className="w-full md:w-1/3 min-h-[300px] md:min-h-[400px]">
            {data && <InfoPanel data={data} />}
          </div>

          {/* Right Panel: Graph */}
          <div className="w-full md:w-2/3 bg-gradient-to-b from-ocean-900 to-ocean-800 relative">
             {/* Decorative header inside graph area for context */}
             <div className="absolute top-4 left-4 z-10">
                <h3 className="text-sm font-bold text-blue-400 uppercase tracking-wider">Nivel del Mar</h3>
             </div>
             
             <div className="h-full flex items-end pb-0">
                {data && <TideChart data={data} />}
             </div>
          </div>
          
          {/* Loading Overlay */}
          {loading && (
             <div className="absolute inset-0 bg-ocean-900/80 backdrop-blur-sm z-50 flex items-center justify-center">
                <div className="flex flex-col items-center gap-4">
                   <div className="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
                   <p className="text-blue-200 font-mono text-sm animate-pulse">Consultando satélites...</p>
                </div>
             </div>
          )}
        </div>

        {/* Bottom Panel: Detailed Tide List */}
        <div className="bg-ocean-900">
          {data && <TideList tides={data.tides} />}
        </div>

      </main>

      {/* Footer */}
      <footer className="p-4 text-center text-xs text-ocean-400">
        <p>MareaCast © {new Date().getFullYear()} • Datos generados por IA (Gemini 2.5 Flash)</p>
      </footer>
    </div>
  );
};

export default App;