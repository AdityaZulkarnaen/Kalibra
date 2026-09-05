'use client';

import { useEffect, useRef, useState } from 'react';

import {
  createForecasts,
  reliabilityCurve,
  seededRandom,
  settle,
  stepForecasts,
  type Forecast,
} from '@/lib/calibration-field';

/**
 * The hero's background.
 *
 * Two layers. Underneath, a canvas drawing the calibration field — the plot the product is
 * built on, animated. Over it, footage, if `heroVideoSrc()` found a file to play; it fades in
 * only once the browser reports it can decode, and an `error` at any later point drops it for
 * good. Either way the canvas is already showing, so the hero is never a black rectangle and
 * never waits on a download.
 *
 * No frame of either layer is a wallet's record. The hero's caption says so.
 */

const FORECAST_COUNT = 150;

/** Seconds between settlements. One position resolving is a small, frequent event. */
const SETTLE_INTERVAL = 0.55;

/** A long frame means a backgrounded tab. Stepping it whole would teleport the field. */
const MAX_FRAME = 1 / 20;

export function HeroBackdrop({ videoSrc }: { videoSrc: string | null }) {
  const [videoUsable, setVideoUsable] = useState(true);
  const [videoReady, setVideoReady] = useState(false);

  return (
    <div className="absolute inset-0 overflow-hidden" aria-hidden="true">
      <CalibrationField />
      {videoSrc !== null && videoUsable && (
        <video
          className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-1000 ${
            videoReady ? 'opacity-100' : 'opacity-0'
          }`}
          src={videoSrc}
          autoPlay
          loop
          muted
          playsInline
          preload="auto"
          onCanPlay={() => setVideoReady(true)}
          onError={() => setVideoUsable(false)}
        />
      )}
    </div>
  );
}

function CalibrationField() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return;
    const ctx = canvas.getContext('2d');
    if (ctx === null) return;

    const styles = getComputedStyle(canvas);
    const signal = styles.getPropertyValue('--signal').trim() || '#7cd6e3';
    const random = seededRandom(0x4b41);
    const forecasts = createForecasts(FORECAST_COUNT, random);

    const resize = () => {
      const scale = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(canvas.clientWidth * scale);
      canvas.height = Math.round(canvas.clientHeight * scale);
      ctx.setTransform(scale, 0, 0, scale, 0, 0);
    };
    resize();
    window.addEventListener('resize', resize);

    // The field is decoration over a hero that reads identically without it, so a reader who
    // has asked for less motion gets one settled frame and no animation loop at all.
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (still) {
      for (let i = 0; i < 240; i += 1) stepForecasts(forecasts, 0, 1 / 60);
      draw(ctx, canvas, forecasts, signal, 0);
      return () => window.removeEventListener('resize', resize);
    }

    let frame = 0;
    let last = performance.now();
    let clock = 0;
    let sinceSettle = 0;

    const tick = (now: number) => {
      const dt = Math.min((now - last) / 1000, MAX_FRAME);
      last = now;
      clock += dt;

      sinceSettle += dt;
      if (sinceSettle >= SETTLE_INTERVAL) {
        sinceSettle = 0;
        const index = Math.floor(random() * forecasts.length);
        const chosen = forecasts[index];
        if (chosen !== undefined) settle(chosen, random);
      }

      stepForecasts(forecasts, clock, dt);
      draw(ctx, canvas, forecasts, signal, clock);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);

    // Off-screen or backgrounded, the loop is pure cost. Restarting resets `last` so the
    // first frame back is a normal one rather than the whole idle period at once.
    const observer = new IntersectionObserver(([entry]) => {
      if (entry?.isIntersecting === false) {
        cancelAnimationFrame(frame);
        frame = 0;
      } else if (frame === 0) {
        last = performance.now();
        frame = requestAnimationFrame(tick);
      }
    });
    observer.observe(canvas);

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener('resize', resize);
    };
  }, []);

  return <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />;
}

/** The unit square, oversized so it bleeds off every edge and keeps the diagonal at 45°. */
function fieldRect(width: number, height: number) {
  const size = Math.max(width, height) * 1.25;
  return { left: (width - size) / 2, top: (height - size) / 2, size };
}

function draw(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  forecasts: readonly Forecast[],
  signal: string,
  t: number,
): void {
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  const rect = fieldRect(width, height);
  const px = (x: number) => rect.left + x * rect.size;
  const py = (y: number) => rect.top + (1 - y) * rect.size;

  ctx.clearRect(0, 0, width, height);
  ctx.lineCap = 'round';

  drawGrid(ctx, rect, signal);
  drawDiagonal(ctx, px, py, signal);
  drawCurve(ctx, px, py, signal, t);
  drawForecasts(ctx, px, py, forecasts, signal);

  ctx.globalAlpha = 1;
}

function drawGrid(
  ctx: CanvasRenderingContext2D,
  rect: ReturnType<typeof fieldRect>,
  signal: string,
): void {
  ctx.globalAlpha = 0.07;
  ctx.strokeStyle = signal;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 0; i <= 10; i += 1) {
    const at = (i / 10) * rect.size;
    ctx.moveTo(rect.left + at, rect.top);
    ctx.lineTo(rect.left + at, rect.top + rect.size);
    ctx.moveTo(rect.left, rect.top + at);
    ctx.lineTo(rect.left + rect.size, rect.top + at);
  }
  ctx.stroke();
}

/** Perfect calibration. Every point on the field is read as distance from this line. */
function drawDiagonal(
  ctx: CanvasRenderingContext2D,
  px: (x: number) => number,
  py: (y: number) => number,
  signal: string,
): void {
  ctx.globalAlpha = 0.28;
  ctx.strokeStyle = signal;
  ctx.lineWidth = 1.5;
  ctx.setLineDash([6, 8]);
  ctx.beginPath();
  ctx.moveTo(px(0), py(0));
  ctx.lineTo(px(1), py(1));
  ctx.stroke();
  ctx.setLineDash([]);
}

function drawCurve(
  ctx: CanvasRenderingContext2D,
  px: (x: number) => number,
  py: (y: number) => number,
  signal: string,
  t: number,
): void {
  ctx.globalAlpha = 0.5;
  ctx.strokeStyle = signal;
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (let i = 0; i <= 80; i += 1) {
    const x = i / 80;
    const y = reliabilityCurve(x, t);
    if (i === 0) ctx.moveTo(px(x), py(y));
    else ctx.lineTo(px(x), py(y));
  }
  ctx.stroke();
}

function drawForecasts(
  ctx: CanvasRenderingContext2D,
  px: (x: number) => number,
  py: (y: number) => number,
  forecasts: readonly Forecast[],
  signal: string,
): void {
  ctx.fillStyle = signal;
  for (const forecast of forecasts) {
    const radius = 1.1 + forecast.weight * 2.6 + forecast.flash * 3.5;
    ctx.globalAlpha = 0.16 + forecast.weight * 0.3 + forecast.flash * 0.5;
    ctx.beginPath();
    ctx.arc(px(forecast.x), py(forecast.y), radius, 0, Math.PI * 2);
    ctx.fill();
  }
}
