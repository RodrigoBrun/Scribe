import { defineConfig } from 'vite';

// GitHub Pages publica este repositorio bajo /Scribe/. En desarrollo y en
// builds locales mantenemos / para que Vite y Go Live sigan funcionando.
const base = process.env.GITHUB_ACTIONS === 'true' ? '/Scribe/' : '/';

export default defineConfig({ base });
