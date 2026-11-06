import React, { useState } from 'react';
export function useChartCursor({ width, left, right, steps = 100 }) {
  const [fraction, setFraction] = useState(null);
  const update = (e) => {
    const svg = e.currentTarget.ownerSVGElement || e.currentTarget;
    const point = svg.createSVGPoint();
    point.x = e.clientX;
    point.y = e.clientY;
    const matrix = svg.getScreenCTM();
    if (!matrix) return;
    const x = point.matrixTransform(matrix.inverse()).x;
    setFraction(Math.max(0, Math.min(1, (x - left) / (width - left - right))));
  };
  return {
    fraction,
    setFraction,
    handlers: {
      onPointerMove: update,
      onPointerDown: (e) => {
        e.currentTarget.setPointerCapture?.(e.pointerId);
        update(e);
      },
      onPointerUp: (e) => e.currentTarget.releasePointerCapture?.(e.pointerId),
      onPointerLeave: () => setFraction(null),
      onBlur: () => setFraction(null),
      onKeyDown: (e) => {
        if (e.key === 'Escape') {
          setFraction(null);
          return;
        }
        if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) {
          e.preventDefault();
          setFraction((f) =>
            e.key === 'Home'
              ? 0
              : e.key === 'End'
                ? 1
                : Math.max(
                    0,
                    Math.min(
                      1,
                      (f ?? 0.5) +
                        (e.key === 'ArrowRight' ? 1 : -1) / Math.max(1, steps),
                    ),
                  ),
          );
        }
      },
    },
  };
}
export function ChartHitArea({ left, top, width, height, handlers, label }) {
  return (
    <rect
      x={left}
      y={top}
      width={width}
      height={height}
      fill="transparent"
      className="chart-hit-area"
      tabIndex={0}
      role="application"
      aria-label={
        label + ' · Move or drag to inspect; arrow keys select, Escape clears'
      }
      {...handlers}
    />
  );
}
export function ChartTooltip({ left, top = 12, children }) {
  return (
    <div
      className="chart-tooltip chart-pill"
      role="status"
      style={{
        left: `clamp(92px, ${left}%, calc(100% - 92px))`,
        top: `max(28px, ${Math.max(5, Math.min(90, top))}%)`,
      }}
    >
      {children}
    </div>
  );
}

export function ChartReadout({ children, label = 'Selected chart values' }) {
  return <span className="chart-readout push-right" role="status" aria-label={label}>{children}</span>;
}
