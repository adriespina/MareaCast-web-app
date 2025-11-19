import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');
    // En Vercel, las variables de entorno están disponibles directamente en process.env
    const worldTidesApiKey = process.env.WORLDTIDES_API_KEY || env.WORLDTIDES_API_KEY;
    return {
      server: {
        port: 3000,
        host: '0.0.0.0',
      },
      plugins: [react()],
      define: {
        'process.env.WORLDTIDES_API_KEY': JSON.stringify(worldTidesApiKey)
      },
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      }
    };
});
