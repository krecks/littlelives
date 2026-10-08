/**
 * Pointer handling on the 3D canvas. Separates clicks from camera drags and
 * throttles hover to once per animation frame. Game logic lives in the handlers.
 *
 * A handler can take a left-button gesture for itself (`press` returns true), e.g. drawing a
 * wall: moves then go to `hover`, the release to `release`, and a right-click while it is held
 * to `cancel`. The press is seen before the camera's own pointer handling (capture phase), so
 * the handler can stop the camera from turning for that drag.
 */

export interface PointerHandlers {
  click(x: number, y: number): void;
  hover(x: number, y: number): void;
  leave(): void;
  /** Left button pressed. Return true to take the gesture (no click, no camera turn). */
  press?(x: number, y: number): boolean;
  /** A taken gesture ended; `moved`: the pointer travelled past the click threshold. */
  release?(x: number, y: number, moved: boolean): void;
  /** Right-click (or right button during a taken gesture). Return true if it cancelled something. */
  cancel?(): boolean;
}

/** Movement (CSS px) after which a press counts as a camera drag, not a click. */
const DRAG_THRESHOLD = 6;

export class PointerInput {
  private downX = 0;
  private downY = 0;
  private dragging = false;
  /** A left-button gesture taken by `press`, until the button goes up. */
  private taken = false;
  /** The taken gesture was cancelled: ignore everything until the button goes up. */
  private dropped = false;
  private hoverQueued = false;
  private hoverX = 0;
  private hoverY = 0;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly handlers: PointerHandlers,
  ) {
    // Capture phase: runs before the camera's listeners on the same canvas.
    canvas.addEventListener('pointerdown', this.onDown, true);
    canvas.addEventListener('pointerup', this.onUp);
    canvas.addEventListener('pointermove', this.onMove);
    canvas.addEventListener('pointerleave', this.onLeave);
    canvas.addEventListener('contextmenu', this.onContextMenu);
  }

  dispose(): void {
    this.canvas.removeEventListener('pointerdown', this.onDown, true);
    this.canvas.removeEventListener('pointerup', this.onUp);
    this.canvas.removeEventListener('pointermove', this.onMove);
    this.canvas.removeEventListener('pointerleave', this.onLeave);
    this.canvas.removeEventListener('contextmenu', this.onContextMenu);
  }

  private readonly onDown = (e: PointerEvent) => {
    if (e.button === 2) {
      // Right-click cancels a drawing in progress (right-drag still pans the camera).
      this.cancelTaken();
      return;
    }
    if (e.button !== 0) return;
    this.downX = e.offsetX;
    this.downY = e.offsetY;
    this.dragging = false;
    this.dropped = false;
    this.taken = this.handlers.press?.(e.offsetX, e.offsetY) ?? false;
    if (this.taken) {
      try {
        this.canvas.setPointerCapture(e.pointerId);
      } catch {
        // Synthetic events have no active pointer to capture.
      }
    }
  };

  private readonly onUp = (e: PointerEvent) => {
    if (e.button !== 0) return;
    if (this.taken || this.dropped) {
      const moved = this.dragging;
      const taken = this.taken;
      this.taken = this.dropped = false;
      this.dragging = false;
      if (taken) this.handlers.release?.(e.offsetX, e.offsetY, moved);
      return;
    }
    if (!this.dragging) this.handlers.click(e.offsetX, e.offsetY);
  };

  private readonly onMove = (e: PointerEvent) => {
    // A second button pressed during a drag arrives as a move with `button` set (chorded).
    if (e.button === 2 && this.taken) this.cancelTaken();
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

  private cancelTaken(): void {
    const cancelled = this.handlers.cancel?.() ?? false;
    if (this.taken || cancelled) {
      this.dropped = this.taken;
      this.taken = false;
    }
  }

  private readonly onLeave = () => {
    // While a gesture is taken the pointer is captured; leaving doesn't end it.
    if (!this.taken) this.handlers.leave();
  };
  private readonly onContextMenu = (e: Event) => {
    e.preventDefault();
    if (this.taken) this.cancelTaken();
  };
}
