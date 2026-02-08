/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // Neo-Industrial Command Center palette
        void: {
          DEFAULT: '#0a0a0f',
          deep: '#06060a',
          surface: '#0f0f18',
        },
        rust: {
          DEFAULT: '#CE422B',
          dark: '#8B2D1D',
          light: '#f47061',
          glow: 'rgba(206, 66, 43, 0.4)',
        },
        electric: {
          pink: '#e94560',
          'pink-hover': '#ff6b6b',
          'pink-glow': 'rgba(233, 69, 96, 0.3)',
        },
        matrix: {
          DEFAULT: '#00ff41',
          dim: '#00cc33',
          glow: 'rgba(0, 255, 65, 0.3)',
        },
        steel: {
          DEFAULT: '#1a1a2e',
          light: '#2a2a4e',
          dark: '#12121f',
        },
        chrome: {
          DEFAULT: '#8a8a9e',
          light: '#eaeaea',
          dark: '#5a5a6e',
        },
        // Keep pihole namespace for backward compatibility
        pihole: {
          dark: '#1a1a2e',
          darker: '#16213e',
          darkest: '#0f0f1e',
          card: '#1a1a2e',
          accent: '#e94560',
          'accent-hover': '#ff6b6b',
          'accent-glow': 'rgba(233, 69, 96, 0.3)',
          success: '#2ecc71',
          warning: '#f1c40f',
          info: '#3498db',
          text: '#eaeaea',
          'text-muted': '#8a8a9e',
          border: '#2a2a4e',
          'terminal-bg': '#0a0a14',
          'terminal-green': '#4ade80',
          'terminal-comment': '#6b7280',
        },
      },
      fontFamily: {
        display: ['Bebas Neue', 'Impact', 'sans-serif'],
        sans: ['IBM Plex Sans', 'Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'monospace'],
      },
      fontSize: {
        'display-xl': ['clamp(3rem, 10vw, 8rem)', { lineHeight: '0.95', letterSpacing: '0.02em' }],
        'display-lg': ['clamp(2.5rem, 8vw, 5rem)', { lineHeight: '1', letterSpacing: '0.02em' }],
        'display-md': ['clamp(2rem, 5vw, 3rem)', { lineHeight: '1.1', letterSpacing: '0.01em' }],
      },
      animation: {
        float: 'float 6s ease-in-out infinite',
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        glow: 'glow 2s ease-in-out infinite',
        scan: 'scan 8s linear infinite',
        'threat-float': 'threatFloat 4s linear forwards',
        vaporize: 'vaporize 0.5s ease-out forwards',
        'counter-roll': 'counterRoll 0.3s ease-out',
        'shield-pulse': 'shieldPulse 2s ease-in-out infinite',
        'matrix-rain': 'matrixRain 20s linear infinite',
      },
      keyframes: {
        float: {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-10px)' },
        },
        glow: {
          '0%, 100%': { boxShadow: '0 0 20px rgba(233, 69, 96, 0.3)' },
          '50%': { boxShadow: '0 0 40px rgba(233, 69, 96, 0.5)' },
        },
        scan: {
          '0%': { transform: 'translateY(-100%)' },
          '100%': { transform: 'translateY(100vh)' },
        },
        threatFloat: {
          '0%': { transform: 'translateX(100vw) scale(1)', opacity: '0.8' },
          '70%': { transform: 'translateX(20vw) scale(1)', opacity: '0.8' },
          '85%': { transform: 'translateX(10vw) scale(0.8)', opacity: '0.4' },
          '100%': { transform: 'translateX(0) scale(0)', opacity: '0' },
        },
        vaporize: {
          '0%': { transform: 'scale(1)', opacity: '1', filter: 'blur(0)' },
          '50%': { transform: 'scale(1.2)', opacity: '0.5', filter: 'blur(2px)' },
          '100%': { transform: 'scale(0)', opacity: '0', filter: 'blur(8px)' },
        },
        counterRoll: {
          '0%': { transform: 'translateY(100%)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
        shieldPulse: {
          '0%, 100%': {
            boxShadow:
              '0 0 30px rgba(206, 66, 43, 0.3), 0 0 60px rgba(233, 69, 96, 0.2), inset 0 0 30px rgba(206, 66, 43, 0.1)',
          },
          '50%': {
            boxShadow:
              '0 0 50px rgba(206, 66, 43, 0.5), 0 0 100px rgba(233, 69, 96, 0.3), inset 0 0 50px rgba(206, 66, 43, 0.2)',
          },
        },
        matrixRain: {
          '0%': { transform: 'translateY(-100%)' },
          '100%': { transform: 'translateY(100%)' },
        },
      },
      backgroundImage: {
        'gradient-rust': 'linear-gradient(135deg, #e94560 0%, #CE422B 100%)',
        'gradient-void': 'linear-gradient(180deg, #0a0a0f 0%, #06060a 100%)',
        'gradient-radial-rust':
          'radial-gradient(ellipse at center, rgba(206, 66, 43, 0.15) 0%, transparent 70%)',
        'grid-pattern': `linear-gradient(rgba(255,255,255,0.02) 1px, transparent 1px),
                         linear-gradient(90deg, rgba(255,255,255,0.02) 1px, transparent 1px)`,
        'scan-line': 'linear-gradient(transparent 50%, rgba(0, 0, 0, 0.1) 50%)',
      },
      backgroundSize: {
        grid: '60px 60px',
        scan: '100% 4px',
      },
      backdropBlur: {
        xs: '2px',
      },
      boxShadow: {
        'rust-glow': '0 0 30px rgba(206, 66, 43, 0.4), 0 0 60px rgba(206, 66, 43, 0.2)',
        'pink-glow': '0 0 30px rgba(233, 69, 96, 0.4), 0 0 60px rgba(233, 69, 96, 0.2)',
        'matrix-glow': '0 0 20px rgba(0, 255, 65, 0.4)',
        glass: '0 8px 32px rgba(0, 0, 0, 0.3)',
        'glass-hover': '0 12px 48px rgba(0, 0, 0, 0.4)',
      },
    },
  },
  plugins: [],
};
