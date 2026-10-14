import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    env: {
      // src/http.ts skips its CLI entrypoint when this is set. Vitest sets it
      // too; keep it explicit so importing the module cannot bind a port.
      VITEST: 'true',
    },
  },
});
