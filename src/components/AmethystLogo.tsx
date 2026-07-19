import { motion } from "framer-motion";

interface AmethystLogoProps {
  size?: number;
}

export default function AmethystLogo({ size = 160 }: AmethystLogoProps) {
  return (
    <motion.div
      className="mx-auto flex shrink-0 items-center justify-center"
      style={{ height: size, width: size }}
      animate={{ y: [0, -8, 0] }}
      transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
    >
      <svg viewBox="0 0 160 160" className="h-full w-full drop-shadow-[0_0_24px_rgba(255,0,255,0.35)]">
        <defs>
          <linearGradient id="amethystHex" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#2a1a30" />
            <stop offset="100%" stopColor="#150a1a" />
          </linearGradient>
          <linearGradient id="amethystFacetA" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#ff8cff" />
            <stop offset="100%" stopColor="#ff00ff" />
          </linearGradient>
          <linearGradient id="amethystFacetB" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#e000e0" />
            <stop offset="100%" stopColor="#7a00a3" />
          </linearGradient>
          <linearGradient id="amethystFacetC" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#c400c4" />
            <stop offset="100%" stopColor="#5b0080" />
          </linearGradient>
        </defs>

        {/* Outer hexagon frame */}
        <polygon
          points="80,10 140,45 140,115 80,150 20,115 20,45"
          fill="url(#amethystHex)"
          stroke="#ff00ff"
          strokeOpacity="0.5"
          strokeWidth="2"
        />

        {/* Faceted crystal cluster */}
        <polygon points="80,40 100,70 80,120 60,70" fill="url(#amethystFacetA)" />
        <polygon points="80,40 100,70 118,55 96,35" fill="url(#amethystFacetB)" />
        <polygon points="80,40 60,70 42,55 64,35" fill="url(#amethystFacetB)" />
        <polygon points="100,70 80,120 112,100" fill="url(#amethystFacetC)" />
        <polygon points="60,70 80,120 48,100" fill="url(#amethystFacetC)" />

        {/* Sparkles */}
        <motion.g
          animate={{ opacity: [0.3, 1, 0.3] }}
          transition={{ duration: 2.2, repeat: Infinity, ease: "easeInOut" }}
        >
          <path d="M34 28 l3 8 l8 3 l-8 3 l-3 8 l-3 -8 l-8 -3 l8 -3 z" fill="#ff8cff" />
        </motion.g>
        <motion.g
          animate={{ opacity: [1, 0.3, 1] }}
          transition={{ duration: 2.6, repeat: Infinity, ease: "easeInOut" }}
        >
          <path d="M128 24 l2 6 l6 2 l-6 2 l-2 6 l-2 -6 l-6 -2 l6 -2 z" fill="#ff8cff" />
        </motion.g>
      </svg>
    </motion.div>
  );
}
