/*
 * Identité de marque « Archodev » — direction artistique « Keystone ».
 * Le logo est un monogramme géométrique : un « A / arche » à couronne plate — la
 * clef de voûte, pierre centrale qui tient l'arche, métaphore du bot qui tient la
 * communauté. Tracé au dégradé signature « aurore » (iris → cyan).
 *
 * Composant purement présentationnel : aucune logique métier.
 */

let gradientSeq = 0;

/** Marque seule (monogramme clef de voûte). Une seule grammaire : forme pleine,
 *  angles vifs, symétrie stricte autour de x=16. */
export function Logo({ size = 28, className = "" }: { size?: number; className?: string }) {
  // Id de dégradé unique par instance : plusieurs logos sur une page ne se
  // télescopent pas (deux <defs> au même id).
  const gid = `archo-aurora-${(gradientSeq += 1)}`;
  return (
    <svg
      viewBox="0 0 32 32"
      width={size}
      height={size}
      className={className}
      role="img"
      aria-label="Archodev"
    >
      <defs>
        <linearGradient id={gid} x1="6" y1="26" x2="26" y2="6" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#6b4ef2" />
          <stop offset="0.5" stopColor="#8a6bff" />
          <stop offset="1" stopColor="#6fc7ff" />
        </linearGradient>
      </defs>
      {/* « A / arche » d'une seule pièce (règle even-odd) : silhouette trapézoïdale
          à couronne plate (la clef de voûte), contre-forme triangulaire et ouverture
          des jambages évidées. La barre fait corps avec les jambages — aucune
          jonction flottante ; tout est symétrique autour de x=16. */}
      <path
        fillRule="evenodd"
        fill={`url(#${gid})`}
        d="M13.4 6 L18.6 6 L28.4 26 L3.6 26 Z M16 10.5 L18.59 16.5 L13.41 16.5 Z M12.11 19.5 L19.89 19.5 L22.7 26 L9.3 26 Z"
      />
    </svg>
  );
}

/** Marque + logotype « Archodev » en police d'affichage. */
export function Wordmark({
  size = 28,
  className = "",
  textClassName = "text-[17px]",
}: {
  size?: number;
  className?: string;
  textClassName?: string;
}) {
  return (
    <span className={`inline-flex items-center gap-2.5 ${className}`}>
      <Logo size={size} />
      <span className={`font-display font-semibold tracking-tight text-zinc-100 ${textClassName}`}>
        Archo<span className="text-indigo-300">dev</span>
      </span>
    </span>
  );
}
