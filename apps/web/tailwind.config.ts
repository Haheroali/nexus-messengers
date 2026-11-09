import type { Config } from 'tailwindcss';
export default { content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'], theme: { extend: { colors: { ink: '#17191d', muted: '#858b93', panel: '#202328', accent: '#7cddba' }, fontFamily: { arabic: ['var(--font-arabic)', 'sans-serif'] } } }, plugins: [] } satisfies Config;
