/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // Pi-hole inspired color palette
        pihole: {
          dark: '#1a1a2e',
          darker: '#16213e',
          darkest: '#0f0f1e',
          accent: '#e94560',
          'accent-hover': '#ff6b6b',
          'accent-glow': 'rgba(233, 69, 96, 0.3)',
          success: '#2ecc71',
          warning: '#f1c40f',
          info: '#3498db',
          text: '#eaeaea',
          'text-muted': '#8a8a9e',
          border: '#2a2a4e',
          // Terminal colors
          'terminal-bg': '#0a0a14',
          'terminal-green': '#4ade80',
          'terminal-comment': '#6b7280',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'monospace'],
      },
    },
  },
  plugins: [],
}
