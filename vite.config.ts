import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const dashboardRoutes = {
  name: 'dashboard-routes',
  configureServer(server) {
    server.httpServer?.once('listening', () => {
      const address = server.httpServer?.address();
      if (!address || typeof address === 'string') return;

      server.config.logger.info('');
      server.config.logger.info(`  User Dashboard:  http://localhost:${address.port}/user`);
      server.config.logger.info(`  Admin Dashboard: http://localhost:${address.port}/admin`);
    });
  },
};

export default defineConfig({
  plugins: [react(), dashboardRoutes],
  server: {
    port: 5173,
  host: true,
  allowedHosts: true,
  proxy: {
      '/supabase': {
        target: 'https://0ec90b57d6e95fcbda19832f.supabase.co',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/supabase/, ''),
      },
    },
  },
});
