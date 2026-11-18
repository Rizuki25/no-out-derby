/**
 * Crisp 5x7 pixel bitmap font for native 480x270 rendering (no anti-aliased blur).
 * Each glyph is 7 rows of 5-bit masks (MSB = leftmost pixel).
 */
const GLYPHS_5X7: Record<string, number[]> = {
  A: [0b01110, 0b10001, 0b10001, 0b11111, 0b10001, 0b10001, 0b10001],
  B: [0b11110, 0b10001, 0b10001, 0b11110, 0b10001, 0b10001, 0b11110],
  C: [0b01110, 0b10001, 0b10000, 0b10000, 0b10000, 0b10001, 0b01110],
  D: [0b11100, 0b10010, 0b10001, 0b10001, 0b10001, 0b10010, 0b11100],
  E: [0b11111, 0b10000, 0b10000, 0b11110, 0b10000, 0b10000, 0b11111],
  F: [0b11111, 0b10000, 0b10000, 0b11110, 0b10000, 0b10000, 0b10000],
  G: [0b01110, 0b10001, 0b10000, 0b10111, 0b10001, 0b10001, 0b01110],
  H: [0b10001, 0b10001, 0b10001, 0b11111, 0b10001, 0b10001, 0b10001],
  I: [0b01110, 0b00100, 0b00100, 0b00100, 0b00100, 0b00100, 0b01110],
  J: [0b00111, 0b00010, 0b00010, 0b00010, 0b10010, 0b10010, 0b01100],
  K: [0b10001, 0b10010, 0b10100, 0b11000, 0b10100, 0b10010, 0b10001],
  L: [0b10000, 0b10000, 0b10000, 0b10000, 0b10000, 0b10000, 0b11111],
  M: [0b10001, 0b11011, 0b10101, 0b10101, 0b10001, 0b10001, 0b10001],
  N: [0b10001, 0b11001, 0b10101, 0b10011, 0b10001, 0b10001, 0b10001],
  O: [0b01110, 0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b01110],
  P: [0b11110, 0b10001, 0b10001, 0b11110, 0b10000, 0b10000, 0b10000],
  Q: [0b01110, 0b10001, 0b10001, 0b10001, 0b10101, 0b10010, 0b01101],
  R: [0b11110, 0b10001, 0b10001, 0b11110, 0b10100, 0b10010, 0b10001],
  S: [0b01111, 0b10000, 0b10000, 0b01110, 0b00001, 0b00001, 0b11110],
  T: [0b11111, 0b00100, 0b00100, 0b00100, 0b00100, 0b00100, 0b00100],
  U: [0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b01110],
  V: [0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b01010, 0b00100],
  W: [0b10001, 0b10001, 0b10001, 0b10101, 0b10101, 0b11011, 0b10001],
  X: [0b10001, 0b10001, 0b01010, 0b00100, 0b01010, 0b10001, 0b10001],
  Y: [0b10001, 0b10001, 0b01010, 0b00100, 0b00100, 0b00100, 0b00100],
  Z: [0b11111, 0b00001, 0b00010, 0b00100, 0b01000, 0b10000, 0b11111],
  '0': [0b01110, 0b10011, 0b10101, 0b10101, 0b11001, 0b10001, 0b01110],
  '1': [0b00100, 0b01100, 0b00100, 0b00100, 0b00100, 0b00100, 0b01110],
  '2': [0b01110, 0b10001, 0b00001, 0b00110, 0b01000, 0b10000, 0b11111],
  '3': [0b11110, 0b00001, 0b00001, 0b01110, 0b00001, 0b00001, 0b11110],
  '4': [0b00010, 0b00110, 0b01010, 0b10010, 0b11111, 0b00010, 0b00010],
  '5': [0b11111, 0b10000, 0b11110, 0b00001, 0b00001, 0b10001, 0b01110],
  '6': [0b01110, 0b10000, 0b10000, 0b11110, 0b10001, 0b10001, 0b01110],
  '7': [0b11111, 0b00001, 0b00010, 0b00100, 0b01000, 0b01000, 0b01000],
  '8': [0b01110, 0b10001, 0b10001, 0b01110, 0b10001, 0b10001, 0b01110],
  '9': [0b01110, 0b10001, 0b10001, 0b01111, 0b00001, 0b00001, 0b01110],
  ':': [0b00000, 0b00100, 0b00100, 0b00000, 0b00100, 0b00100, 0b00000],
  '-': [0b00000, 0b00000, 0b00000, 0b11111, 0b00000, 0b00000, 0b00000],
  '+': [0b00000, 0b00100, 0b00100, 0b11111, 0b00100, 0b00100, 0b00000],
  '.': [0b00000, 0b00000, 0b00000, 0b00000, 0b00000, 0b00100, 0b00100],
  ',': [0b00000, 0b00000, 0b00000, 0b00000, 0b00100, 0b00100, 0b01000],
  '!': [0b00100, 0b00100, 0b00100, 0b00100, 0b00100, 0b00000, 0b00100],
  '?': [0b01110, 0b10001, 0b00001, 0b00110, 0b00100, 0b00000, 0b00100],
  '/': [0b00001, 0b00010, 0b00010, 0b00100, 0b01000, 0b01000, 0b10000],
  '[': [0b01110, 0b01000, 0b01000, 0b01000, 0b01000, 0b01000, 0b01110],
  ']': [0b01110, 0b00010, 0b00010, 0b00010, 0b00010, 0b00010, 0b01110],
  '(': [0b00110, 0b01000, 0b10000, 0b10000, 0b10000, 0b01000, 0b00110],
  ')': [0b01100, 0b00010, 0b00001, 0b00001, 0b00001, 0b00010, 0b01100],
  '%': [0b11001, 0b11010, 0b00010, 0b00100, 0b01000, 0b01011, 0b10011],
  "'": [0b00100, 0b00100, 0b01000, 0b00000, 0b00000, 0b00000, 0b00000],
  '>': [0b10000, 0b01000, 0b00100, 0b00010, 0b00100, 0b01000, 0b10000],
  '<': [0b00001, 0b00010, 0b00100, 0b01000, 0b00100, 0b00010, 0b00001],
  '&': [0b01100, 0b10010, 0b10100, 0b01000, 0b10101, 0b10010, 0b01101],
  '^': [0b00000, 0b00100, 0b01010, 0b10001, 0b00000, 0b00000, 0b00000],
  '~': [0b00000, 0b00000, 0b01100, 0b10011, 0b00000, 0b00000, 0b00000],
  '|': [0b00100, 0b00100, 0b00100, 0b00100, 0b00100, 0b00100, 0b00100],
  ' ': [0b00000, 0b00000, 0b00000, 0b00000, 0b00000, 0b00000, 0b00000],
};

export const ARCADE_FONT_FAMILY = 'pixel-5x7';
export const ARCADE_DISPLAY_FONT = 'pixel-5x7-display';

export interface ArcadeTextOptions {
  weight?: string | number;
  family?: string;
  italic?: boolean;
  shadowColor?: string;
  strokeColor?: string;
  strokeWidth?: number;
  uppercase?: boolean;
  baseline?: 'top' | 'middle';
}

export function measurePixelText(text: string, scale = 1): number {
  if (!text.length) return 0;
  return text.length * 6 * scale - scale;
}

export function measureArcadeText(
  _ctx: CanvasRenderingContext2D,
  text: string,
  sizePx = 8
): number {
  const scale = sizePx >= 23 ? 3 : sizePx >= 19 ? 2.5 : sizePx >= 12 ? 2 : sizePx >= 10 ? 1.5 : 1;
  return measurePixelText(text, scale);
}

function snapHalf(v: number): number {
  return Math.round(v * 2) / 2;
}

/** Extra logical padding around a cached glyph run so shadows/outlines are never clipped. */
const TEXT_SPRITE_PAD = 3;
const MAX_TEXT_SPRITES = 320;
/** Cap total cached pixels (~4 bytes each) so dynamic strings cannot balloon memory. */
const MAX_TEXT_SPRITE_PIXELS = 4_000_000;

interface TextSprite {
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
  /** Device pixels backing this sprite, used to bound total cache memory. */
  pixels: number;
}

const textSpriteCache = new Map<string, TextSprite>();
let cachedPixels = 0;
/** Device-pixel scale of the target context, so cached sprites blit 1:1 without resampling. */
let ctxScaleCache = new WeakMap<CanvasRenderingContext2D, number>();

/**
 * Drops every cached glyph run. Must be called when the canvas render scale changes, because the
 * sprites are rasterized at the device-pixel scale baked into their cache key and blitted 1:1.
 */
export function clearTextSpriteCache(): void {
  textSpriteCache.clear();
  cachedPixels = 0;
  ctxScaleCache = new WeakMap<CanvasRenderingContext2D, number>();
}

/**
 * Paints one glyph run at (baseX, baseY). Each glyph row is a 5-bit mask, so adjacent lit
 * pixels are merged into a single fillRect, cutting draw calls ~3x with identical output.
 */
function paintGlyphRun(
  ctx: CanvasRenderingContext2D,
  upper: string,
  baseX: number,
  baseY: number,
  color: string,
  scale: number,
  shadowColor?: string,
  outlineColor?: string
): void {
  const dot = snapHalf(scale);

  const renderPass = (ox: number, oy: number, fill: string) => {
    ctx.fillStyle = fill;
    let cx = baseX + ox;
    for (let i = 0; i < upper.length; i++) {
      const ch = upper[i];
      const rows = GLYPHS_5X7[ch] ?? GLYPHS_5X7[' '];
      for (let r = 0; r < 7; r++) {
        const mask = rows[r];
        if (!mask) continue;
        const rowY = baseY + oy + r * scale;
        let runStart = -1;
        for (let c = 0; c <= 5; c++) {
          const lit = c < 5 && (mask & (1 << (4 - c))) !== 0;
          if (lit) {
            if (runStart < 0) runStart = c;
          } else if (runStart >= 0) {
            ctx.fillRect(cx + runStart * scale, rowY, (c - runStart) * scale, dot);
            runStart = -1;
          }
        }
      }
      cx += 6 * scale;
    }
  };

  if (shadowColor) {
    const sh = Math.max(0.5, Math.min(2, dot * 0.5));
    renderPass(sh + (outlineColor ? 0.5 : 0), sh + (outlineColor ? 0.5 : 0), shadowColor);
  }
  if (outlineColor) {
    const out = Math.max(0.5, Math.min(1.5, Math.round(scale) * 0.5));
    renderPass(-out, 0, outlineColor);
    renderPass(out, 0, outlineColor);
    renderPass(0, -out, outlineColor);
    renderPass(0, out, outlineColor);
  }
  renderPass(0, 0, color);
}

function getContextScale(ctx: CanvasRenderingContext2D): number {
  const cached = ctxScaleCache.get(ctx);
  if (cached !== undefined) return cached;
  let scale = 1;
  try {
    const transform = ctx.getTransform?.();
    const a = transform?.a;
    if (typeof a === 'number' && Number.isFinite(a) && a > 0) {
      scale = Math.min(4, Math.max(1, a));
    }
  } catch {
    // Fall through to 1x for mock/unsupported contexts
  }
  // The game sets its pixel-ratio transform once per frame, and no draw pass changes the scale,
  // so caching avoids allocating a DOMMatrix for every text string drawn.
  ctxScaleCache.set(ctx, scale);
  return scale;
}

function createSpriteCanvas(width: number, height: number): HTMLCanvasElement | null {
  if (typeof document === 'undefined' || typeof document.createElement !== 'function') return null;
  try {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    return canvas;
  } catch {
    return null;
  }
}

/**
 * Renders a glyph run into a cached offscreen canvas. Static HUD/menu strings are repainted
 * every frame, so caching turns hundreds of fillRects into a single drawImage.
 *
 * `fracX`/`fracY` are the sub-pixel phases of the target position (text is snapped to half
 * pixels). They are baked into the sprite and the blit is anchored to the floored position, so
 * the cached path rounds every glyph pixel exactly like the direct fillRect path does.
 */
function getTextSprite(
  ctx: CanvasRenderingContext2D,
  upper: string,
  color: string,
  scale: number,
  shadowColor: string | undefined,
  outlineColor: string | undefined,
  ctxScale: number,
  fracX: number,
  fracY: number
): TextSprite | null {
  if (typeof ctx.drawImage !== 'function') return null;
  const key = `${ctxScale}|${scale}|${fracX}|${fracY}|${color}|${shadowColor ?? ''}|${outlineColor ?? ''}|${upper}`;
  const cached = textSpriteCache.get(key);
  if (cached) return cached;

  const logicalW = measurePixelText(upper, scale) + TEXT_SPRITE_PAD * 2 + 1;
  const logicalH = 7 * scale + TEXT_SPRITE_PAD * 2 + 1;
  const canvasW = Math.max(1, Math.ceil(logicalW * ctxScale));
  const canvasH = Math.max(1, Math.ceil(logicalH * ctxScale));
  const canvas = createSpriteCanvas(canvasW, canvasH);
  if (!canvas) return null;
  const spriteCtx = canvas.getContext('2d');
  if (!spriteCtx) return null;

  spriteCtx.setTransform(ctxScale, 0, 0, ctxScale, 0, 0);
  spriteCtx.imageSmoothingEnabled = false;
  paintGlyphRun(
    spriteCtx,
    upper,
    TEXT_SPRITE_PAD + fracX,
    TEXT_SPRITE_PAD + fracY,
    color,
    scale,
    shadowColor,
    outlineColor
  );

  const sprite: TextSprite = {
    canvas,
    width: canvasW / ctxScale,
    height: canvasH / ctxScale,
    pixels: canvasW * canvasH,
  };
  // Evict oldest entries until both the entry-count and pixel-memory budgets fit again.
  while (
    textSpriteCache.size >= MAX_TEXT_SPRITES ||
    cachedPixels + canvasW * canvasH > MAX_TEXT_SPRITE_PIXELS
  ) {
    const oldest = textSpriteCache.keys().next();
    if (oldest.done) break;
    const evicted = textSpriteCache.get(oldest.value);
    textSpriteCache.delete(oldest.value);
    if (evicted) cachedPixels -= evicted.pixels;
  }
  cachedPixels += sprite.pixels;
  textSpriteCache.set(key, sprite);
  return sprite;
}

function drawBitmapPixelText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  color: string,
  scale = 1,
  align: 'left' | 'center' | 'right' = 'left',
  shadowColor?: string,
  outlineColor?: string
): void {
  const upper = text.toUpperCase();
  const totalW = measurePixelText(upper, scale);
  let startX = snapHalf(x);
  if (align === 'center') startX = snapHalf(x - totalW * 0.5);
  else if (align === 'right') startX = snapHalf(x - totalW);
  const startY = snapHalf(y);

  const baseX = Math.floor(startX);
  const baseY = Math.floor(startY);
  const sprite = getTextSprite(
    ctx,
    upper,
    color,
    scale,
    shadowColor,
    outlineColor,
    getContextScale(ctx),
    startX - baseX,
    startY - baseY
  );
  if (sprite) {
    ctx.drawImage(
      sprite.canvas,
      baseX - TEXT_SPRITE_PAD,
      baseY - TEXT_SPRITE_PAD,
      sprite.width,
      sprite.height
    );
    return;
  }

  paintGlyphRun(ctx, upper, startX, startY, color, scale, shadowColor, outlineColor);
}

export function drawArcadeText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  color: string,
  sizePx = 8,
  align: 'left' | 'center' | 'right' = 'left',
  opts: ArcadeTextOptions = {}
): void {
  const scale = sizePx >= 23 ? 3 : sizePx >= 19 ? 2.5 : sizePx >= 12 ? 2 : sizePx >= 10 ? 1.5 : 1;
  const topY = opts.baseline === 'top' ? y : y - 3.5 * scale;
  drawBitmapPixelText(ctx, text, x, topY, color, scale, align, opts.shadowColor, opts.strokeColor);
}

export function drawPixelText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  color: string,
  scale = 1,
  align: 'left' | 'center' | 'right' = 'left',
  shadowColor?: string
): void {
  drawBitmapPixelText(ctx, text, x, y, color, scale, align, shadowColor);
}
