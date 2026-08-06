import { useEffect, useRef } from "react";
import * as skinview3d from "skinview3d";

interface SkinViewerProps {
  skinUrl?: string;
  capeUrl?: string;
  width?: number;
  height?: number;
  autoRotate?: boolean;
}

/**
 * Real-time 3D skin preview backed by skinview3d (three.js under the hood).
 * Supports drag-to-orbit, scroll-to-zoom, an idle animation, and hot-swapping
 * the skin/cape whenever the active account changes.
 */
export default function SkinViewer({
  skinUrl,
  capeUrl,
  width = 260,
  height = 340,
  autoRotate = true,
}: SkinViewerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewerRef = useRef<skinview3d.SkinViewer | null>(null);

  // Create the viewer once.
  useEffect(() => {
    if (!canvasRef.current) return;

    const viewer = new skinview3d.SkinViewer({
      canvas: canvasRef.current,
      width,
      height,
      fov: 50,
      zoom: 0.9,
    });

    viewer.autoRotate = autoRotate;
    viewer.autoRotateSpeed = 0.8;
    viewer.controls.enableZoom = true;
    viewer.controls.enablePan = false;
    viewer.controls.minDistance = 20;
    viewer.controls.maxDistance = 80;

    // Idle animation: gentle breathing/sway so the model never feels static.
    const idle = new skinview3d.IdleAnimation();
    viewer.animation = idle;

    viewerRef.current = viewer;

    return () => {
      viewer.dispose();
      viewerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [width, height]);

  // Load / hot-swap skin + cape whenever they change.
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;

    if (skinUrl) {
      viewer.loadSkin(skinUrl).catch((err) => console.error("Failed to load skin", err));
    }
    if (capeUrl) {
      viewer.loadCape(capeUrl).catch((err) => console.error("Failed to load cape", err));
    } else {
      viewer.loadCape(null as unknown as string);
    }
  }, [skinUrl, capeUrl]);

  useEffect(() => {
    if (viewerRef.current) viewerRef.current.autoRotate = autoRotate;
  }, [autoRotate]);

  return <canvas ref={canvasRef} className="rounded-lg" />;
}
