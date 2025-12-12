
import React, { useEffect, useRef, useLayoutEffect, forwardRef, useImperativeHandle } from 'react';
import { SignatureAnalysis, HandwritingStyle } from '../types';
import { AnimationEngine, ExportFormat } from '../services/animationEngine';

interface CanvasAnimatorProps {
  imageSrc: string;
  isAnimating: boolean;
  soundEnabled: boolean;
  visualizeStrokeOrder?: boolean;
  analysisData?: SignatureAnalysis | null;
  preset?: HandwritingStyle;
  strokeColor?: string;
  bgColor?: string;
  thicknessScale?: number;
  animationDuration?: number; // seconds
  onAnimationComplete?: () => void;
  onVideoGenerated?: (url: string) => void;
  className?: string;
}

export interface CanvasAnimatorHandle {
    exportAnimation: (format: ExportFormat) => void;
}

export const CanvasAnimator = forwardRef<CanvasAnimatorHandle, CanvasAnimatorProps>(({
  imageSrc,
  isAnimating,
  soundEnabled,
  visualizeStrokeOrder = false,
  analysisData,
  preset,
  strokeColor = '#111111',
  bgColor = '#fdfbf7',
  thicknessScale = 1.0,
  animationDuration = 2.0,
  onAnimationComplete,
  onVideoGenerated,
  className
}, ref) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<AnimationEngine | null>(null);

  useImperativeHandle(ref, () => ({
    exportAnimation: (format: ExportFormat) => {
        if (engineRef.current) {
            engineRef.current.start(format);
        }
    }
  }));

  // Update sound setting dynamically
  useEffect(() => {
    if (engineRef.current) {
        engineRef.current.setSoundEnabled(soundEnabled);
    }
  }, [soundEnabled]);

  useLayoutEffect(() => {
    let isMounted = true;
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Load image first
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.src = imageSrc;

    const initEngine = () => {
       if (!isMounted) return;

       // Resize logic
       const parent = canvas.parentElement;
       if (parent) {
         const aspectRatio = img.width / img.height || 1.5;
         let finalWidth = parent.clientWidth;
         let finalHeight = finalWidth / aspectRatio;
         
         if (!finalWidth || finalWidth <= 0) finalWidth = 600;
         if (!finalHeight || finalHeight <= 0) finalHeight = 400;

         canvas.width = finalWidth;
         canvas.height = finalHeight;
       }

       // Initialize Engine
       if (engineRef.current) {
         engineRef.current.stop();
       }

       engineRef.current = new AnimationEngine(
         canvas,
         img,
         analysisData || null,
         preset,
         strokeColor,
         bgColor,
         thicknessScale,
         animationDuration,
         onAnimationComplete,
         onVideoGenerated
       );
       
       engineRef.current.setSoundEnabled(soundEnabled);

       // Decide what to do based on props
       if (isAnimating) {
         engineRef.current.start();
       } else if (visualizeStrokeOrder) {
         engineRef.current.drawDebug();
       } else {
         engineRef.current.drawStatic();
       }
    };

    if (img.complete) {
      initEngine();
    } else {
      img.onload = initEngine;
    }

    return () => {
      isMounted = false;
      if (engineRef.current) {
        engineRef.current.stop();
        engineRef.current = null;
      }
    };
  }, [imageSrc, isAnimating, analysisData, preset, visualizeStrokeOrder, strokeColor, bgColor, thicknessScale, animationDuration]);

  return (
    <div className={`relative flex items-center justify-center bg-white rounded-lg overflow-hidden shadow-lg ${className}`}>
      <canvas 
        ref={canvasRef} 
        className="max-w-full max-h-full"
        style={{ backgroundColor: bgColor }} 
      />
    </div>
  );
});
