import { defineConfig } from 'vite';

export default defineConfig({
  // The preview harness assigns a port via PORT; default to 5173 otherwise.
  server: { port: Number(process.env.PORT) || 5173, strictPort: false },
});
