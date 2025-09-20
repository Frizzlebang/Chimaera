import { defineConfig, loadEnv } from 'vite'
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  // Load env vars from parent directory (where your .env file is)
  const env = loadEnv(mode, '../', 'VITE_')
  
  console.log('Loaded VITE_DEVTOOLS:', env.VITE_DEVTOOLS)
  console.log('Loaded VITE_API_URL:', env.VITE_API_URL)
  
  return {
    server: { host: true, port: 5173 },
    preview: { host: true, port: 5173 },
    plugins: [react()],
    define: {
      // Explicitly define env vars so they're available in import.meta.env
      'import.meta.env.VITE_DEVTOOLS': JSON.stringify(env.VITE_DEVTOOLS || '0'),
      'import.meta.env.VITE_API_URL': JSON.stringify(env.VITE_API_URL || 'http://localhost:2567'),
    }
  }
})