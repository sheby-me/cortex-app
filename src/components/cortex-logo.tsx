import React from "react";

interface CortexLogoProps extends React.SVGProps<SVGSVGElement> {
  size?: number | string;
  className?: string;
  /**
   * If true, inverts colors in dark mode for maximum contrast.
   * Default: true.
   */
  invertInDark?: boolean;
}

export const CortexLogo: React.FC<CortexLogoProps> = ({
  size = 32,
  className = "",
  invertInDark = true,
  ...props
}) => {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={`shrink-0 transition-all duration-300 ${
        invertInDark ? "text-slate-900 dark:text-slate-50" : "text-current"
      } ${className}`}
      {...props}
    >
      <g transform="translate(0, 2)">
        {/* Bold Stylized 'C' */}
        <path
          d="M 68,44
             C 61,35 48,33 36,40
             C 22,48 18,65 24,79
             C 30,92 46,97 60,93
             C 70,90 77,81 80,73
             L 67,68
             C 64,74 58,79 51,80
             C 40,81 31,75 28,65
             C 25,54 30,44 40,40
             C 48,37 57,39 62,45
             Z"
          fill="currentColor"
        />

        {/* Transparent Classy Graduation Cap */}
        <g stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
          {/* Diamond Top Plate - transparent interior */}
          <polygon points="58,12 86,21 60,31 32,22" fill="none" strokeWidth="3.5" />

          {/* Skullcap Crown Band */}
          <path
            d="M 40,25 C 40,35 78,35 78,25 L 78,30 C 78,38 40,38 40,30 Z"
            fill="none"
            strokeWidth="2.8"
          />

          {/* Band Windows */}
          <path
            d="M 46,29 L 52,29 L 52,33 L 46,33 Z M 66,29 L 72,29 L 72,33 L 66,33 Z"
            fill="none"
            strokeWidth="2"
          />

          {/* Center Button */}
          <circle cx="59" cy="21.5" r="2.2" fill="currentColor" stroke="none" />

          {/* Tassel Cord & Fringe */}
          <path d="M 59,21.5 C 70,22.5 81,25 83,30 L 83,43" fill="none" strokeWidth="2.2" />
          <circle cx="83" cy="43" r="1.8" fill="currentColor" stroke="none" />
          <path
            d="M 80,45 L 86,45 M 79,48 L 87,48 M 80,51 L 86,51 M 83,45 L 83,53"
            fill="none"
            strokeWidth="2"
          />
        </g>
      </g>
    </svg>
  );
};

export const CortexBrand: React.FC<{
  logoSize?: number;
  subtitle?: string;
  className?: string;
}> = ({ logoSize = 32, subtitle, className = "" }) => {
  return (
    <div className={`flex items-center gap-2.5 ${className}`}>
      <div className="grid h-9 w-9 place-items-center rounded-xl bg-secondary/80 dark:bg-accent/80 border border-border/80 p-1 shadow-xs transition-colors">
        <CortexLogo size={logoSize} />
      </div>
      <div className="flex flex-col leading-tight">
        <span className="text-base font-display font-bold tracking-tight text-foreground">
          Cortex
        </span>
        {subtitle && (
          <span className="text-xs text-muted-foreground font-medium">{subtitle}</span>
        )}
      </div>
    </div>
  );
};
