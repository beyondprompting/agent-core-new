import { useId, useState } from "react";
import { ImageIcon } from "lucide-react";
import type { Piece } from "@/app/lib/qa-visual/review-model";

export function Avatar({
  type,
  name,
  small = false,
}: {
  name?: string;
  type: "robot" | "you";
  small?: boolean;
}) {
  const faceId = useId();
  return (
    <span className={`avatar ${small ? "avatar-small" : ""} avatar-${type}`}>
      {type === "robot" ? (
        <svg viewBox="0 0 40 40" role="img" aria-label="Avatar de robot">
          <defs>
            <linearGradient id={faceId} x2="0" y2="1">
              <stop stopColor="#fff" />
              <stop offset="1" stopColor="#bcc5f4" />
            </linearGradient>
          </defs>
          <path d="M20 8V5" stroke="#b6b9ff" strokeWidth="2" />
          <circle cx="20" cy="5" r="2" fill="#e3e3ff" />
          <rect
            x="7"
            y="12"
            width="26"
            height="21"
            rx="8"
            fill={`url(#${faceId})`}
          />
          <rect x="4" y="19" width="4" height="9" rx="2" fill="#b7bdf3" />
          <rect x="32" y="19" width="4" height="9" rx="2" fill="#b7bdf3" />
          <rect x="11" y="17" width="18" height="10" rx="4" fill="#282455" />
          <rect x="14" y="20" width="3" height="4" rx="1.5" fill="#a9efff" />
          <rect x="23" y="20" width="3" height="4" rx="1.5" fill="#a9efff" />
          <path
            d="M17 30h6"
            stroke="#7a80bd"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </svg>
      ) : (
        name
          ?.trim()
          .split(/\s+/)
          .slice(0, 2)
          .map((part) => part[0]?.toUpperCase())
          .join("") || "•"
      )}
    </span>
  );
}

export function Artwork({
  piece,
  eager = false,
  thumbnail = false,
  onDimensions,
}: {
  piece: Piece;
  eager?: boolean;
  thumbnail?: boolean;
  onDimensions?: (width: number, height: number) => void;
}) {
  const [failedImage, setFailedImage] = useState<string>();
  const src = thumbnail ? piece.thumbnail : piece.image;
  return (
    <div
      className={`artwork ${piece.height > piece.width ? "artwork-story" : ""}`}
      style={{
        aspectRatio:
          piece.width && piece.height
            ? `${piece.width} / ${piece.height}`
            : undefined,
      }}
    >
      {!src || (thumbnail && failedImage === src) ? (
        <span className="artwork-unavailable" aria-hidden="true">
          {thumbnail ? <ImageIcon size={16} /> : "Preparando imagen…"}
        </span>
      ) : failedImage === src ? (
        <span className="artwork-unavailable">Imagen no disponible</span>
      ) : (
        <img
          onError={() => setFailedImage(src)}
          onLoad={({ currentTarget }) =>
            onDimensions?.(
              currentTarget.naturalWidth,
              currentTarget.naturalHeight,
            )
          }
          src={src}
          alt={piece.name}
          draggable={false}
          loading={eager ? "eager" : "lazy"}
          decoding="async"
        />
      )}
    </div>
  );
}
