<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# MareaCast - Aplicación de Predicción de Mareas

Aplicación web para consultar predicciones de mareas usando APIs públicas y bases de datos abiertas.

## Características

- 🌊 Predicciones de mareas en tiempo real
- 📍 Búsqueda por nombre de lugar o coordenadas
- 🗺️ Visualización en mapa
- 📊 Gráficos interactivos de nivel del mar
- ☀️ Horarios de salida y puesta del sol
- 🌍 Funciona globalmente sin necesidad de API keys (opcional para mayor precisión)

## APIs y Fuentes de Datos Utilizadas

La aplicación utiliza las siguientes fuentes de datos, priorizando fuentes oficiales españolas:

### Fuentes Oficiales Españolas (Prioridad Alta)
- **Tablademareas.com**: Datos oficiales del Instituto Hidrográfico de la Marina (IHM)
  - Acceso mediante scraping con proxy CORS
  - Cubre los principales puertos españoles
  - Datos basados en el Anuario de Mareas del IHM

- **Mapeo de Puertos IHM**: Base de datos de puertos oficiales del IHM
  - Mapeo automático de ciudades a puertos más cercanos
  - Incluye más de 30 puertos españoles principales

### APIs Públicas Internacionales
- **Nominatim (OpenStreetMap)**: Geocodificación gratuita para convertir nombres de lugares a coordenadas
- **Sunrise-Sunset API**: Datos de salida y puesta del sol
- **WorldTides API** (opcional): Predicciones precisas de mareas (requiere API key gratuita)
  - Se usa como fallback si no hay datos disponibles de fuentes españolas

### Fallback
- **Cálculo astronómico**: Fórmulas de marea cuando no hay datos de APIs disponibles

## Instalación y Uso

**Prerrequisitos:** Node.js

1. Instalar dependencias:
   ```bash
   npm install
   ```

2. (Opcional) Configurar variables de entorno en `.env.local`:
   ```
   WORLDTIDES_API_KEY=tu_api_key_aqui
   ```
   > Nota: Puedes obtener una API key gratuita en [WorldTides.info](https://www.worldtides.info/apidocs) (1000 requests/mes gratis)

3. Ejecutar la aplicación:
   ```bash
   npm run dev
   ```

4. Construir para producción:
   ```bash
   npm run build
   ```

## Despliegue en Vercel

La aplicación está configurada para desplegarse automáticamente en Vercel:

1. Conecta tu repositorio a Vercel
2. (Opcional) Agrega `WORLDTIDES_API_KEY` en las variables de entorno de Vercel
3. Vercel detectará automáticamente la configuración y desplegará la app

## Tecnologías

- React 19
- TypeScript
- Vite
- Tailwind CSS
- Recharts (gráficos)
- APIs públicas de datos abiertos
