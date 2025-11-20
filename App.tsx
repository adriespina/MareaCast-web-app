import React, { useEffect, useState } from 'react';
import { Header } from './components/Header';
import { InfoPanel } from './components/InfoPanel';
import { TideChart } from './components/TideChart';
import { TideList } from './components/TideList';
import { MapView } from './components/MapView';
import { fetchTideData } from './services/tideApiService';
import { TideData } from './types';

const App: React.FC = () => {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<TideData | null>(null);
  const [location, setLocation] = useState<string>("Vigo");
  const [contextMenu, setContextMenu] = useState<{ visible: boolean; x: number; y: number; inputValue: string }>({
    visible: false,
    x: 0,
    y: 0,
    inputValue: '',
  });

  const loadData = async (loc: string) => {
    setLoading(true);
    try {
      const tideData = await fetchTideData(loc);
      setData(tideData);
    } catch (error) {
      console.error("Failed to load data", error);
      // Asegurar que siempre tenemos datos, incluso si falla
      // fetchTideData siempre retorna datos (mock si falla), pero por si acaso:
      try {
        const fallbackData = await fetchTideData("Vigo");
        setData(fallbackData);
      } catch (fallbackError) {
        console.error("Fallback also failed", fallbackError);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // Initial load
    loadData(location);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const handleClick = () => {
      if (contextMenu.visible) {
        setContextMenu(prev => ({ ...prev, visible: false }));
      }
    };
    window.addEventListener('click', handleClick);
    return () => window.removeEventListener('click', handleClick);
  }, [contextMenu.visible]);

  const handleSearch = (term: string) => {
    setLocation(term);
    loadData(term);
  };

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    setContextMenu({
      visible: true,
      x: e.clientX,
      y: e.clientY,
      inputValue: location
    });
  };

  const handleContextSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (contextMenu.inputValue.trim()) {
      handleSearch(contextMenu.inputValue);
      setContextMenu(prev => ({ ...prev, visible: false }));
    }
  };

  const handleLocate = () => {
    if ('geolocation' in navigator) {
      setLoading(true);
      navigator.geolocation.getCurrentPosition(async (position) => {
        const { latitude, longitude } = position.coords;
        // Reverse geocoding via text search logic in geminiService can handle coords too
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

  // Mostrar error solo si realmente falló después de intentar cargar
  if (!data && !loading) {
    return (
      <div className="min-h-screen bg-ocean-900 text-white flex items-center justify-center">
        <div className="text-center">
          <p className="text-xl mb-4">Error cargando datos</p>
          <button 
            onClick={() => loadData(location)} 
            className="bg-blue-600 hover:bg-blue-500 px-4 py-2 rounded"
          >
            Reintentar
          </button>
        </div>
      </div>
    );
  }

  return (
    <div 
      className="min-h-screen bg-ocean-900 text-white font-sans selection:bg-blue-500 selection:text-white flex flex-col"
      onContextMenu={handleContextMenu}
    >
      {/* Top Bar */}
      <Header
        locationName={data?.locationName || location}
        requestedName={data?.requestedName || location}
        referenceLocationName={data?.referenceLocationName}
        date={data?.date || ""}
        onSearch={handleSearch}
        onLocate={handleLocate}
        isLoading={loading}
      />

      {data?.dataDisclaimer && (
        <div className="bg-amber-900/60 text-amber-100 text-sm px-4 py-2 border-b border-amber-700 text-center">
          <strong className="mr-1">Aviso:</strong> {data.dataDisclaimer}
          {data.sourceError && <span className="ml-1 text-amber-200/80">({data.sourceError})</span>}
        </div>
      )}

      <main className="flex-1 flex flex-col max-w-5xl mx-auto w-full shadow-2xl bg-ocean-800 overflow-hidden md:my-8 md:rounded-xl border border-ocean-700">
        
        {/* Top Map Strip */}
        <MapView
          locationName={data?.locationName || location}
          coordinates={data?.coordinates}
          requestedName={data?.requestedName}
        />

        {/* Main Content Area - Split View */}
        <div className="flex flex-col md:flex-row border-b border-ocean-600 relative">
          
          {/* Left Panel: Key Stats (Big Arrow, Current Height, Sun) */}
          <div className="w-full md:w-1/3 min-h-[300px] md:min-h-[400px]">
            {data && <InfoPanel data={data} />}
          </div>

          {/* Right Panel: Graph */}
          <div className="w-full md:w-2/3 relative">
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

      {/* Custom Context Menu */}
      {contextMenu.visible && (
        <div 
          className="fixed bg-ocean-800 border border-ocean-600 shadow-2xl rounded-lg p-4 z-50 min-w-[200px] animate-fade-in"
          style={{ top: contextMenu.y, left: contextMenu.x }}
          onClick={(e) => e.stopPropagation()}
        >
          <h4 className="text-sm font-bold text-blue-300 mb-2">Cambiar Localización</h4>
          <form onSubmit={handleContextSubmit} className="flex flex-col gap-2">
            <input 
              type="text" 
              value={contextMenu.inputValue}
              onChange={(e) => setContextMenu(prev => ({ ...prev, inputValue: e.target.value }))}
              className="bg-ocean-900 border border-ocean-600 rounded px-2 py-1 text-sm focus:border-blue-500 outline-none text-white"
              autoFocus
            />
            <button type="submit" className="bg-blue-600 hover:bg-blue-500 text-white text-sm py-1 rounded transition-colors">
              Actualizar
            </button>
          </form>
        </div>
      )}

      {/* Footer */}
      <footer className="p-4 text-center text-xs text-ocean-400">
        <p>MareaCast © {new Date().getFullYear()} • Datos del Instituto Hidrográfico de la Marina (IHM) y fuentes oficiales españolas</p>
      </footer>
    </div>
  );
};

export default App;