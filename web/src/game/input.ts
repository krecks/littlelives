/**
 * Pointer handling on the 3D canvas. Separates clicks from camera drags and
 * throttles hover to once per animation frame. Game logic lives in the handlers.
 */

export interface PointerHandlers {
  click(x: number, y: number): void;
  hover(x: number, y: number): void;
  leave(): void;
}

/** Movement (CSS px) after which a press counts as a camera drag, not a click. */
const DRAG_THRESHOLD = 6;

export class PointerInput {
  private downX = 0;
  private downY = 0;
  private dragging = false;
  private hoverQueued = false;
  private hoverX = 0;
  private hoverY = 0;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly handlers: PointerHandlers,
  ) {
    canvas.addEventListener('pointerdown', this.onDown);
    canvas.addEventListener('pointerup', this.onUp);
    canvas.addEventListener('pointermove', this.onMove);
    canvas.addEventListener('pointerleave', this.onLeave);
    canvas.addEventListener('contextmenu', this.onContextMenu);
  }

  dispose(): void {
    this.canvas.removeEventListener('pointerdown', this.onDown);
    this.canvas.removeEventListener('pointerup', this.onUp);
    this.canvas.removeEventListener('pointermove', this.onMove);
    this.canvas.removeEventListener('pointerleave', this.onLeave);
    this.canvas.removeEventListener('contextmenu', this.onContextMenu);
  }

  private readonly onDown = (e: PointerEvent) => {
    this.downX = e.offsetX;
    this.downY = e.offsetY;
    this.dragging = false;
  };

  private readonly onUp = (e: PointerEvent) => {
    if (e.button === 0 && !this.dragging) this.handlers.click(e.offsetX, e.offsetY);
  };

  private readonly onMove = (e: PointerEvent) => {
    if (e.buttons && Math.hypot(e.offsetX - this.downX, e.offsetY - this.downY) > DRAG_THRESHOLD) this.dragging = true;
    this.hoverX = e.offsetX;
    this.hoverY = e.offsetY;
    if (!this.hoverQueued) {
      this.hoverQueued = true;
      requestAnimationFrame(() => {
        this.hoverQueued = false;
        this.handlers.hover(this.hoverX, this.hoverY);
      });
    }
  };

  private readonly onLeave = () => this.handlers.leave();
  private readonly onContextMenu = (e: Event) => e.preventDefault();
}
