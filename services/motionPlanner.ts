
import { SignatureAnalysis, HandwritingStyle, PhysicsPoint, StrokePath } from '../types';

// Simple distance function
const dist = (p1: {x:number, y:number}, p2: {x:number, y:number}) => {
  const dx = p1.x - p2.x;
  const dy = p1.y - p2.y;
  return Math.sqrt(dx*dx + dy*dy);
};

// Filter Redundant Points
const filterRedundantPoints = (points: {x: number, y: number, z?: number, a?: number}[]) => {
  if (points.length < 2) return points;
  const result = [points[0]];
  
  for (let i = 1; i < points.length; i++) {
    const prev = result[result.length - 1];
    const curr = points[i];
    
    // Threshold: 0.1 pixels squared
    const d2 = (curr.x - prev.x) ** 2 + (curr.y - prev.y) ** 2;
    
    if (d2 > 0.1) {
      result.push(curr);
    }
  }
  
  const lastSrc = points[points.length - 1];
  const lastRes = result[result.length - 1];
  if ((lastRes.x !== lastSrc.x) || (lastRes.y !== lastSrc.y)) {
    result.push(lastSrc);
  }
  
  return result;
};

export const generateMotionPlan = (
  data: SignatureAnalysis, 
  canvasWidth: number, 
  canvasHeight: number, 
  style?: HandwritingStyle
): StrokePath[] => {
  if (!data || !data.strokes) return [];

  const paths: StrokePath[] = [];
  let currentTime = 0;
  
  // Physics Constants
  const baseMsPerPx = style ? style.base_ms_per_px : 1.2;
  const baseWidthScale = style ? (style.pressure_scale || 1) : 1;
  const fallbackWidth = 1.5 * baseWidthScale;
  const inertia = style ? style.inertia_factor : 0;
  
  // Tremor Constants
  const tremorAmp = style ? style.micro_tremor_amp_px : 0;
  const tremorFreq = style ? style.micro_tremor_freq_hz : 0;

  let prevEndPos: {x: number, y: number} | null = null;
  const SCALE_FACTOR = 10000; 

  data.strokes.forEach((stroke, index) => {
      const rawPoints = stroke.points || [];
      if (rawPoints.length < 2) return;

      // 1. Map Coordinates & Attributes
      const mappedPoints = rawPoints.map(p => ({
          x: (p.x / SCALE_FACTOR) * canvasWidth,
          y: (p.y / SCALE_FACTOR) * canvasHeight,
          z: p.z, // Normalized width
          a: p.a  // Opacity
      }));

      // 2. Conservative Filter
      const processedPoints = filterRedundantPoints(mappedPoints);

      // 3. Pen Lift Calculation
      if (prevEndPos) {
          const d = dist(processedPoints[0], prevEndPos);
          if (d > 30) {
              const liftTime = Math.min(d * 0.5, 250) + 50;
              currentTime += liftTime;
          }
      }

      const startTime = currentTime;
      const physicsPoints: PhysicsPoint[] = [];
      
      // 4. Generate Traversal Points
      for (let i = 0; i < processedPoints.length; i++) {
          const p = processedPoints[i];
          
          // Apply Tremor
          let tx = 0, ty = 0;
          if (tremorAmp > 0 && tremorFreq > 0) {
              const tSec = currentTime / 1000;
              tx = tremorAmp * Math.sin(tSec * tremorFreq * Math.PI * 2);
              ty = tremorAmp * Math.cos(tSec * tremorFreq * Math.PI * 2);
          }

          // Calculate Width
          // If z exists, it's relative to width. Convert to pixels.
          // Apply style scale as a multiplier for artistic effect if desired, 
          // or strictly use original if style scale is default.
          let pointWidth = fallbackWidth;
          if (p.z !== undefined) {
             pointWidth = (p.z / SCALE_FACTOR) * canvasWidth * baseWidthScale;
          }
          
          // Calculate Opacity
          const pointOpacity = p.a !== undefined ? p.a : 1.0;

          if (i === 0) {
              physicsPoints.push({
                  x: p.x + tx,
                  y: p.y + ty,
                  time: currentTime, 
                  lineWidth: pointWidth, 
                  opacity: pointOpacity
              });
              continue;
          }

          const prev = processedPoints[i-1];
          const d = dist(p, prev);
          
          // Speed Modulation
          let speedPenalty = 1;
          if (i > 1 && inertia > 0) {
             const prevPrev = processedPoints[i-2];
             const v1x = prev.x - prevPrev.x;
             const v1y = prev.y - prevPrev.y;
             const v2x = p.x - prev.x;
             const v2y = p.y - prev.y;
             
             const mag1 = Math.sqrt(v1x*v1x + v1y*v1y);
             const mag2 = Math.sqrt(v2x*v2x + v2y*v2y);
             
             if (mag1 > 0.001 && mag2 > 0.001) {
                 const dot = v1x*v2x + v1y*v2y;
                 const cosTheta = Math.max(-1, Math.min(1, dot / (mag1 * mag2)));
                 const angle = Math.acos(cosTheta); 
                 speedPenalty = 1 + (angle * inertia); 
             }
          }

          const dt = Math.max(0.01, d * baseMsPerPx * speedPenalty);
          currentTime += dt;

          if (tremorAmp > 0 && tremorFreq > 0) {
              const tSec = currentTime / 1000;
              tx = tremorAmp * Math.sin(tSec * tremorFreq * Math.PI * 2);
              ty = tremorAmp * Math.cos(tSec * tremorFreq * Math.PI * 2);
          }

          physicsPoints.push({
              x: p.x + tx, 
              y: p.y + ty, 
              time: currentTime, 
              lineWidth: pointWidth, 
              opacity: pointOpacity
          });
      }

      paths.push({
          id: `stroke-${index}`,
          points: physicsPoints,
          startTime,
          endTime: currentTime
      });

      prevEndPos = processedPoints[processedPoints.length - 1];
  });

  return paths;
};
