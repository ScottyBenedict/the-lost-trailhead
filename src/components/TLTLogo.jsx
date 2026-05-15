export default function TLTLogo({ size = 120, color = '#1a2a1c', className = '' }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 200 200"
      width={size}
      height={size}
      className={className}
      aria-hidden="true"
    >
      <defs>
        <filter id="tlt-distress" x="-10%" y="-10%" width="120%" height="120%" colorInterpolationFilters="sRGB">
          <feTurbulence type="fractalNoise" baseFrequency="0.06" numOctaves="4" seed="2" stitchTiles="stitch" result="edge-noise"/>
          <feDisplacementMap in="SourceGraphic" in2="edge-noise" scale="2.2" xChannelSelector="R" yChannelSelector="G" result="displaced"/>
          <feTurbulence type="fractalNoise" baseFrequency="0.055" numOctaves="3" seed="12" stitchTiles="stitch" result="speckle-noise"/>
          <feColorMatrix type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  25 0 0 0 -19" in="speckle-noise" result="speckle-mask"/>
          <feComposite in="displaced" in2="speckle-mask" operator="out"/>
        </filter>
      </defs>
      <g filter="url(#tlt-distress)" fill={color}>
        <g transform="rotate(5, 100, 100)">
          <circle cx="100" cy="100" r="65" fill="none" stroke={color} strokeWidth="14"/>
          <polygon points="100,4 87,35 113,35"/>
          <polygon points="100,196 87,165 113,165"/>
          <polygon points="196,100 165,87 165,113"/>
          <polygon points="4,100 35,87 35,113"/>
        </g>
        <text
          x="100" y="118"
          textAnchor="middle"
          fontFamily="'Josefin Sans', 'Arial Narrow', sans-serif"
          fontWeight="700"
          fontSize="44"
          letterSpacing="5"
          fill={color}
        >TLT</text>
      </g>
    </svg>
  )
}
