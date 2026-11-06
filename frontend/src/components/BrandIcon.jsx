import React from 'react';
export default function BrandIcon({ name = 'overview', size = 18 }) {
  if (name === 'claude' || name === 'codex')
    return (
      <img
        className="brand-icon"
        width={size}
        height={size}
        src={`/brands/${name}.png`}
        alt=""
      />
    );
  return (
    <span
      className={`icon-tile icon-${name}`}
      style={{ width: size + 3, height: size + 3 }}
      aria-hidden="true"
    >
      <svg
        viewBox="0 0 24 24"
        width={size - 3}
        height={size - 3}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {name === 'overview' || name === 'enterprise' ? (
          <path d="M13 3c1 5-4 5-2 9 2-1 3-3 3-5 4 4 6 7 4 11-2 4-9 4-11 0-3-5 0-9 4-12-1 3-1 4 0 5 1-3 3-5 2-8zm-1 11c-3 3-3 5 0 6 3-1 3-3 0-6z" />
        ) : name === 'models' || name === 'subscriptions' ? (
          <>
            <rect x="5" y="5" width="14" height="14" rx="3" />
            <rect x="8" y="8" width="8" height="8" rx="1" />
          </>
        ) : name === 'tokens' ? (
          <>
            <ellipse cx="12" cy="6" rx="8" ry="3" />
            <path d="M4 6v6c0 4 16 4 16 0V6M4 12v6c0 4 16 4 16 0" />
          </>
        ) : name === 'ratio' ? (
          <>
            <circle cx="12" cy="12" r="9" />
            <path d="M8 16l8-8m-8 0h.01M16 16h.01" />
          </>
        ) : (
          <path d="M5 20V12M12 20V7M19 20V3" />
        )}
      </svg>
    </span>
  );
}
