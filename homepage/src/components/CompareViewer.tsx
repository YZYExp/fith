import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { KeyboardEvent, MouseEvent, PointerEvent } from "react";

export interface CompareViewerProps {
  /** Browser screenshot (ground truth). */
  before: string;
  /** fith's SVG output. */
  after: string;
  width: number;
  height: number;
  /** Point (fractions of width/height) to centre on when zooming in from the toolbar. */
  focus?: readonly [number, number];
  zoomLevel?: number;
  label: string;
}

/**
 * One viewer for "screenshot vs SVG": a divider splits the two layers, and the
 * zoomed view pans by dragging or scrolling. The divider lives in viewport
 * coordinates, so it stays put while the content pans underneath it.
 */
export function CompareViewer({
  before,
  after,
  width,
  height,
  focus = [0.5, 0.5],
  zoomLevel = 4,
  label,
}: CompareViewerProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [split, setSplit] = useState(0.5);
  const [zoom, setZoom] = useState(1);
  const [scrollLeft, setScrollLeft] = useState(0);
  const [viewportWidth, setViewportWidth] = useState(0);
  const [overflowsY, setOverflowsY] = useState(false);
  const pendingCenter = useRef<[number, number] | null>(null);
  const drag = useRef<
    | { kind: "divider" }
    | { kind: "pan"; x: number; y: number; left: number; top: number }
    | null
  >(null);
  const [dragging, setDragging] = useState(false);

  // Reset when the viewer switches to another example.
  useEffect(() => {
    setZoom(1);
    setSplit(0.5);
    scrollRef.current?.scrollTo(0, 0);
  }, [after]);

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const measure = () => {
      setViewportWidth(element.clientWidth);
      setOverflowsY(element.scrollHeight > element.clientHeight + 1);
    };
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    measure();
    return () => observer.disconnect();
  }, []);

  // After a zoom change, scroll so the requested content point is centred.
  useLayoutEffect(() => {
    const element = scrollRef.current;
    const center = pendingCenter.current;
    if (!element || !center) return;
    pendingCenter.current = null;
    const contentWidth = element.scrollWidth;
    const contentHeight = element.scrollHeight;
    element.scrollTo({
      left: center[0] * contentWidth - element.clientWidth / 2,
      top: center[1] * contentHeight - element.clientHeight / 2,
    });
    setScrollLeft(element.scrollLeft);
  }, [zoom]);

  function zoomTo(next: number, center: [number, number]) {
    if (next === zoom) return;
    pendingCenter.current = center;
    setZoom(next);
  }

  function visibleCenter(): [number, number] {
    const element = scrollRef.current;
    if (!element) return [0.5, 0.5];
    return [
      (element.scrollLeft + element.clientWidth / 2) / element.scrollWidth,
      (element.scrollTop + element.clientHeight / 2) / element.scrollHeight,
    ];
  }

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    const element = scrollRef.current;
    if (!element) return;
    if (zoom > 1 || element.scrollHeight > element.clientHeight) {
      drag.current = {
        kind: "pan",
        x: event.clientX,
        y: event.clientY,
        left: element.scrollLeft,
        top: element.scrollTop,
      };
    } else {
      // At fit size a plain click/drag moves the divider directly.
      drag.current = { kind: "divider" };
      moveDivider(event.clientX);
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragging(true);
  }

  function moveDivider(clientX: number) {
    const element = scrollRef.current;
    if (!element) return;
    const box = element.getBoundingClientRect();
    setSplit(Math.min(1, Math.max(0, (clientX - box.left) / box.width)));
  }

  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    const state = drag.current;
    const element = scrollRef.current;
    if (!state || !element) return;
    if (state.kind === "divider") moveDivider(event.clientX);
    else {
      element.scrollLeft = state.left - (event.clientX - state.x);
      element.scrollTop = state.top - (event.clientY - state.y);
    }
  }

  function endDrag() {
    drag.current = null;
    setDragging(false);
  }

  function onDoubleClick(event: MouseEvent<HTMLDivElement>) {
    const element = scrollRef.current;
    if (!element) return;
    const box = element.getBoundingClientRect();
    const x =
      (element.scrollLeft + event.clientX - box.left) / element.scrollWidth;
    const y =
      (element.scrollTop + event.clientY - box.top) / element.scrollHeight;
    zoomTo(zoom > 1 ? 1 : zoomLevel, [x, y]);
  }

  function onHandleKey(event: KeyboardEvent<HTMLDivElement>) {
    const step = event.shiftKey ? 0.1 : 0.02;
    let next = split;
    if (event.key === "ArrowLeft") next = split - step;
    else if (event.key === "ArrowRight") next = split + step;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = 1;
    else return;
    event.preventDefault();
    setSplit(Math.min(1, Math.max(0, next)));
  }

  const pannable = zoom > 1 || overflowsY;

  // Clip the SVG layer at the divider, expressed in content pixels.
  const contentWidth = viewportWidth * zoom;
  const clipLeft = contentWidth
    ? ((scrollLeft + split * viewportWidth) / contentWidth) * 100
    : split * 100;
  const percent = Math.round(split * 100);

  return (
    <div className="compare">
      <div className="compare-toolbar">
        <div className="compare-legend" aria-hidden="true">
          <span>← 浏览器截图</span>
          <span>fith SVG →</span>
        </div>
        <div className="segmented" role="group" aria-label={`${label}缩放`}>
          <button
            type="button"
            aria-pressed={zoom === 1}
            onClick={() => zoomTo(1, visibleCenter())}
          >
            适应
          </button>
          <button
            type="button"
            aria-pressed={zoom > 1}
            onClick={() => zoomTo(zoomLevel, [focus[0], focus[1]])}
          >
            放大 {zoomLevel}×
          </button>
        </div>
      </div>
      <div className="compare-frame">
        <div
          ref={scrollRef}
          className="compare-scroll"
          data-zoomed={zoom > 1}
          data-pannable={pannable}
          data-dragging={dragging}
          style={{ aspectRatio: `${width} / ${height}` }}
          onScroll={(event) => setScrollLeft(event.currentTarget.scrollLeft)}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onDoubleClick={onDoubleClick}
        >
          <div
            className="compare-canvas"
            style={{
              width: `${zoom * 100}%`,
              aspectRatio: `${width} / ${height}`,
            }}
          >
            <img
              src={before}
              alt={`${label}：浏览器截图`}
              width={width}
              height={height}
              draggable={false}
              decoding="async"
              loading="lazy"
            />
            <img
              src={after}
              alt={`${label}：fith 生成的 SVG`}
              width={width}
              height={height}
              draggable={false}
              decoding="async"
              loading="lazy"
              style={{ clipPath: `inset(0 0 0 ${clipLeft}%)` }}
            />
          </div>
        </div>
        <div
          className="compare-divider"
          style={{ left: `${split * 100}%` }}
          aria-hidden="true"
        />
        <div
          className="compare-handle"
          role="slider"
          tabIndex={0}
          aria-label="分割线位置：左侧截图，右侧 SVG"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
          aria-valuetext={`截图 ${percent}%，SVG ${100 - percent}%`}
          style={{ left: `${split * 100}%` }}
          onKeyDown={onHandleKey}
          onPointerDown={(event) => {
            event.stopPropagation();
            drag.current = { kind: "divider" };
            event.currentTarget.setPointerCapture(event.pointerId);
            setDragging(true);
          }}
          onPointerMove={(event) => {
            if (drag.current?.kind === "divider") moveDivider(event.clientX);
          }}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M9 6 3 12l6 6M15 6l6 6-6 6" />
          </svg>
        </div>
      </div>
      <p className="compare-hint">
        {zoom > 1
          ? "拖动画面平移，双击回到全图。截图在放大后变糊，SVG 保持清晰。"
          : "拖动分割线对比两侧，双击任意位置放大。"}
      </p>
    </div>
  );
}
