import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  
  build: {
    // Nettoie le répertoire de sortie
    emptyOutDir: true,
    // Dossier de sortie standard (dist)
    outDir: "dist",
    sourcemap: false,
  },
})
