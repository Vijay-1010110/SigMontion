
import { SignatureAnalysis, Stroke, RawPoint } from '../types';

interface Point { x: number, y: number }

// Helper: Squared Distance
const distSq = (p1: RawPoint, p2: RawPoint) => (p1.x - p2.x)**2 + (p1.y - p2.y)**2;

// Helper: Weighted Smoothing with Thickness/Opacity
// Weights: 0.1, 0.8, 0.1 (Reduced from 0.15, 0.7, 0.15 to preserve corners)
const smoothPoints = (points: RawPoint[]): RawPoint[] => {
  if (points.length < 3) return points;
  
  const result: RawPoint[] = [points[0]]; // Start point fixed
  
  for (let i = 1; i < points.length - 1; i++) {
    const prev = points[i - 1];
    const curr = points[i];
    const next = points[i + 1];
    
    // Smooth positions (Less aggressive)
    const nx = Math.round(0.1 * prev.x + 0.8 * curr.x + 0.1 * next.x);
    const ny = Math.round(0.1 * prev.y + 0.8 * curr.y + 0.1 * next.y);

    // Smooth attributes if they exist
    let nz = curr.z;
    let na = curr.a;

    if (curr.z !== undefined && prev.z !== undefined && next.z !== undefined) {
      nz = 0.1 * prev.z + 0.8 * curr.z + 0.1 * next.z;
    }
    if (curr.a !== undefined && prev.a !== undefined && next.a !== undefined) {
      na = 0.1 * prev.a + 0.8 * curr.a + 0.1 * next.a;
    }

    result.push({ x: nx, y: ny, z: nz, a: na });
  }
  
  result.push(points[points.length - 1]); // End point fixed
  return result;
};

// Helper: Jitter Filter (Denoise)
const filterJitter = (points: RawPoint[]): RawPoint[] => {
  if (points.length < 3) return points;
  
  let input = points;
  // Two passes to catch alternating jitter patterns
  for (let pass = 0; pass < 2; pass++) {
      const clean: RawPoint[] = [input[0]];
      
      for (let i = 1; i < input.length - 1; i++) {
          const prev = input[i - 1];
          const curr = input[i];
          const next = input[i + 1];
          
          const d1 = distSq(prev, curr);
          const d2 = distSq(curr, next);
          
          // Threshold: 2500 units squared (~50 units distance on 10000 scale)
          const SHORT_SEGMENT_SQ = 2500;
          
          if (d1 < SHORT_SEGMENT_SQ && d2 < SHORT_SEGMENT_SQ) {
              const v1x = curr.x - prev.x;
              const v1y = curr.y - prev.y;
              const v2x = next.x - curr.x;
              const v2y = next.y - curr.y;
              
              const dot = v1x * v2x + v1y * v2y;
              const magSq = d1 * d2;
              
              // Detect sharp turns (>90 degrees) on short segments
              if (magSq > 0 && dot < 0) { 
                  // It's a short, sharp spike (jitter). Skip 'curr' to smooth it out.
                  continue; 
              }
          }
          clean.push(curr);
      }
      clean.push(input[input.length - 1]);
      
      if (clean.length < 3) return clean;
      input = clean;
  }
  
  return input;
};

// Helper: Optimize Stroke Order (Multi-Hypothesis)
const optimizeStrokeOrder = (strokes: Stroke[]): Stroke[] => {
  if (strokes.length === 0) return [];
  
  // 1. Deep Clone Helper
  const cloneStrokes = (src: Stroke[]) => src.map(s => ({...s, points: s.points.map(p => ({...p}))}));

  // 2. Metadata Helper
  const getMeta = (s: Stroke) => {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    let sumX = 0, sumY = 0;
    for (const p of s.points) {
        if (p.x < minX) minX = p.x;
        if (p.x > maxX) maxX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.y > maxY) maxY = p.y;
        sumX += p.x;
        sumY += p.y;
    }
    return {
        stroke: s,
        cx: sumX / s.points.length,
        cy: sumY / s.points.length,
        minX, maxX, minY, maxY,
        width: maxX - minX,
        height: maxY - minY,
        start: s.points[0],
        end: s.points[s.points.length - 1]
    };
  };

  // 3. Identify & Separate Decorations (Underlines)
  const initialMeta = strokes.map(getMeta);
  let globalMinX = Infinity, globalMaxX = -Infinity, globalMinY = Infinity, globalMaxY = -Infinity;
  initialMeta.forEach(m => {
      if (m.minX < globalMinX) globalMinX = m.minX;
      if (m.maxX > globalMaxX) globalMaxX = m.maxX;
      if (m.minY < globalMinY) globalMinY = m.minY;
      if (m.maxY > globalMaxY) globalMaxY = m.maxY;
  });
  const totalW = globalMaxX - globalMinX;
  const totalH = globalMaxY - globalMinY;
  
  const underlineIndices = new Set<number>();
  initialMeta.forEach((m, i) => {
     const isWide = m.width > totalW * 0.35;
     const isLow = m.cy > globalMinY + totalH * 0.65;
     const isFlat = m.width > m.height * 2.5;
     if (isWide && isLow && isFlat) underlineIndices.add(i);
  });

  // 4. Solver Function
  const solve = (inputStrokes: Stroke[], useBias: boolean): Stroke[] => {
      const pool = inputStrokes.map(getMeta);
      if (pool.length === 0) return [];
      
      pool.sort((a, b) => a.minX - b.minX);
      
      const result: Stroke[] = [];
      let curr = pool.shift()!;
      
      if (curr.end.x < curr.start.x && curr.width > curr.height) {
          curr.stroke.points.reverse();
          const t = curr.start; curr.start = curr.end; curr.end = t;
      }
      result.push(curr.stroke);
      
      while (pool.length > 0) {
          let bestIdx = -1;
          let bestCost = Infinity;
          let reverseBest = false;
          
          for (let i = 0; i < pool.length; i++) {
              const cand = pool[i];
              const dStart = distSq(curr.end, cand.start);
              const dEnd = distSq(curr.end, cand.end);
              
              const backwardThresh = 500; 
              const isBackStart = cand.cx < curr.end.x - backwardThresh;
              const isBackEnd = cand.cx < curr.end.x - backwardThresh; 
              
              let costStart = dStart;
              let costEnd = dEnd;
              
              if (useBias) {
                  if (isBackStart && dStart > 2500) costStart *= 5.0;
                  if (isBackEnd && dEnd > 2500) costEnd *= 5.0;
                  const yDiff = Math.abs(cand.cy - curr.cy);
                  costStart += yDiff * 5; 
                  costEnd += yDiff * 5;
              }
              
              if (costStart < bestCost) {
                  bestCost = costStart;
                  bestIdx = i;
                  reverseBest = false;
              }
              if (costEnd < bestCost) {
                  bestCost = costEnd;
                  bestIdx = i;
                  reverseBest = true;
              }
          }
          
          if (bestIdx !== -1) {
              const winner = pool[bestIdx];
              pool.splice(bestIdx, 1);
              if (reverseBest) {
                  winner.stroke.points.reverse();
                  const t = winner.start; winner.start = winner.end; winner.end = t;
              }
              result.push(winner.stroke);
              curr = winner;
          } else {
              break;
          }
      }
      return result;
  };
  
  const getScore = (seq: Stroke[]) => {
      let d = 0;
      for (let i = 0; i < seq.length - 1; i++) {
          const p1 = seq[i].points[seq[i].points.length - 1];
          const p2 = seq[i+1].points[0];
          d += Math.sqrt(distSq(p1, p2));
          if (p2.x < p1.x - 100) d += 50; 
      }
      return d;
  }

  const mainStrokes = strokes.filter((_, i) => !underlineIndices.has(i));
  const underlineStrokes = strokes.filter((_, i) => underlineIndices.has(i));

  const h1 = solve(cloneStrokes(mainStrokes), false);
  const h2 = solve(cloneStrokes(mainStrokes), true);
  
  const s1 = getScore(h1);
  const s2 = getScore(h2);
  
  const bestMain = (s2 < s1 * 1.3) ? h2 : h1;
  
  return [...bestMain, ...cloneStrokes(underlineStrokes)];
};

const despeckleBitmask = (data: Uint8Array, width: number, height: number, minSize: number) => {
  const seen = new Uint8Array(data.length);
  const stack: number[] = [];

  for (let i = 0; i < data.length; i++) {
    if (data[i] === 1 && seen[i] === 0) {
      let count = 0;
      let ptr = 0;
      stack.length = 0; 
      stack.push(i);
      seen[i] = 1;
      
      const componentIndices: number[] = [i];

      while (ptr < stack.length) {
        const idx = stack[ptr++];
        count++;
        
        const cx = idx % width;
        const cy = Math.floor(idx / width);

        const neighbors = [
           { x: cx - 1, y: cy },
           { x: cx + 1, y: cy },
           { x: cx, y: cy - 1 },
           { x: cx, y: cy + 1 }
        ];

        for (const n of neighbors) {
           if (n.x >= 0 && n.x < width && n.y >= 0 && n.y < height) {
               const nIdx = n.y * width + n.x;
               if (data[nIdx] === 1 && seen[nIdx] === 0) {
                   seen[nIdx] = 1;
                   stack.push(nIdx);
                   componentIndices.push(nIdx);
               }
           }
        }
      }

      if (count < minSize) {
          for (const idx of componentIndices) {
              data[idx] = 0;
          }
      }
    }
  }
};

const validateStrokeCoverage = (
  stroke: Stroke, 
  bitmask: Uint8Array, 
  width: number, 
  height: number, 
  outputScale: number
): boolean => {
    if (stroke.points.length < 2) return true;

    let hits = 0;
    let checks = 0;
    
    const scaleX = width / outputScale;
    const scaleY = height / outputScale;

    for (let i = 0; i < stroke.points.length - 1; i++) {
        const p1 = stroke.points[i];
        const p2 = stroke.points[i+1];
        
        const dist = Math.sqrt(distSq(p1, p2));
        const stepSize = 2 / scaleX;
        const steps = Math.ceil(dist / Math.max(1, stepSize * outputScale)); 

        for (let j = 0; j <= steps; j++) {
            const t = steps === 0 ? 0 : j / steps;
            const x = p1.x + (p2.x - p1.x) * t;
            const y = p1.y + (p2.y - p1.y) * t;

            const bx = Math.floor(x * scaleX);
            const by = Math.floor(y * scaleY);

            if (bx >= 0 && bx < width && by >= 0 && by < height) {
                checks++;
                let isInk = false;
                for (let ry = -1; ry <= 1; ry++) {
                    for (let rx = -1; rx <= 1; rx++) {
                        const idx = (by + ry) * width + (bx + rx);
                        if (idx >= 0 && idx < bitmask.length && bitmask[idx] > 0) {
                            isInk = true;
                            break;
                        }
                    }
                    if (isInk) break;
                }
                if (isInk) hits++;
            }
        }
    }

    if (checks === 0) return false;
    return (hits / checks) >= 0.55;
};

export const analyzeSignatureLocal = (
  imageSrc: string
): Promise<SignatureAnalysis> => {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    
    img.onload = () => {
      try {
        // --- HIGH FIDELITY GEOMETRY SETTINGS ---
        const MAX_PROCESS_WIDTH = 1200; // Increased resolution for better precision
        const scale = Math.min(1, MAX_PROCESS_WIDTH / img.width);
        const pWidth = Math.floor(img.width * scale);
        const pHeight = Math.floor(img.height * scale);

        const cvs = document.createElement('canvas');
        cvs.width = pWidth;
        cvs.height = pHeight;
        const ctx = cvs.getContext('2d', { willReadFrequently: true });
        if (!ctx) throw new Error("Could not get context");

        ctx.drawImage(img, 0, 0, pWidth, pHeight);
        const imageData = ctx.getImageData(0, 0, pWidth, pHeight);
        const data = imageData.data;
        
        const visited = new Uint8Array(pWidth * pHeight); 
        
        for (let i = 0; i < data.length; i += 4) {
           const r = data[i];
           const g = data[i+1];
           const b = data[i+2];
           const a = data[i+3];
           const lum = (0.299*r + 0.587*g + 0.114*b);
           
           if (lum < 200 && a > 50) { 
             const idx = i / 4;
             visited[idx] = 1; 
           }
        }
        
        despeckleBitmask(visited, pWidth, pHeight, 20); // Slightly larger speckle filter for high-res

        const rawStrokes: Stroke[] = [];
        const OUTPUT_SCALE = 10000;
        const getXY = (idx: number) => ({ x: idx % pWidth, y: Math.floor(idx / pWidth) });
        
        // --- TUNED WALKER PARAMETERS ---
        const PEN_RADIUS = 3; // Radius of consumed ink (approx 7px diameter)
        const SEARCH_RADIUS = 5; // Look for ink centroid within this radius
        let globalSearchIdx = 0;
        let active = true;
        let safetyCounter = 0;

        while (active && safetyCounter < 10000) {
            safetyCounter++;
            
            let startIdx = -1;
            while (globalSearchIdx < visited.length) {
                if (visited[globalSearchIdx] === 1) {
                    startIdx = globalSearchIdx;
                    break;
                }
                globalSearchIdx++;
            }

            if (startIdx === -1) {
                active = false;
                break; 
            }

            const strokePoints: RawPoint[] = [];
            let currentPos = getXY(startIdx);
            let tracing = true;
            let strokeSafety = 0;

            while (tracing && strokeSafety < 10000) {
                strokeSafety++;
                
                // --- SAMPLING THICKNESS & OPACITY ---
                const cxInt = Math.round(currentPos.x);
                const cyInt = Math.round(currentPos.y);
                const sampleIdx = cyInt * pWidth + cxInt;

                // Opacity (0-1 based on luminance/alpha)
                let opacity = 1.0;
                if (sampleIdx >= 0 && sampleIdx < data.length/4) {
                   const offset = sampleIdx * 4;
                   const alpha = data[offset + 3] / 255.0;
                   const lum = (0.299*data[offset] + 0.587*data[offset+1] + 0.114*data[offset+2]);
                   const darkness = 1.0 - (lum / 255.0);
                   opacity = alpha * Math.max(0.1, darkness); 
                }

                // Thickness (Raycast until background)
                let radius = 1;
                for(let r=1; r<20; r++) { // Increased range
                    const chk = [
                        {x:cxInt+r, y:cyInt}, {x:cxInt-r, y:cyInt},
                        {x:cxInt, y:cyInt+r}, {x:cxInt, y:cyInt-r}
                    ];
                    let hitBg = false;
                    for (const c of chk) {
                        if (c.x < 0 || c.x >= pWidth || c.y < 0 || c.y >= pHeight) { hitBg = true; break; }
                        const idx = c.y * pWidth + c.x;
                        if (visited[idx] === 0) { hitBg = true; break; } 
                    }
                    if (hitBg) { radius = r; break; }
                }
                const thicknessNorm = ((radius * 2) / pWidth) * OUTPUT_SCALE;

                strokePoints.push({
                    x: Math.round((currentPos.x / pWidth) * OUTPUT_SCALE),
                    y: Math.round((currentPos.y / pHeight) * OUTPUT_SCALE),
                    z: thicknessNorm,
                    a: parseFloat(opacity.toFixed(2))
                });

                // Consume Ink
                const cx = Math.round(currentPos.x);
                const cy = Math.round(currentPos.y);
                
                for (let dy = -PEN_RADIUS; dy <= PEN_RADIUS; dy++) {
                    for (let dx = -PEN_RADIUS; dx <= PEN_RADIUS; dx++) {
                        if (dx*dx + dy*dy <= PEN_RADIUS*PEN_RADIUS) {
                            const nx = cx + dx;
                            const ny = cy + dy;
                            if (nx >= 0 && nx < pWidth && ny >= 0 && ny < pHeight) {
                                const nIdx = ny * pWidth + nx;
                                if (visited[nIdx] === 1) {
                                    visited[nIdx] = 2; // Mark as consumed
                                }
                            }
                        }
                    }
                }

                // Centroid Calculation (Tracking)
                let sumX = 0, sumY = 0, count = 0;
                const minX = Math.max(0, cx - SEARCH_RADIUS);
                const maxX = Math.min(pWidth, cx + SEARCH_RADIUS);
                const minY = Math.max(0, cy - SEARCH_RADIUS);
                const maxY = Math.min(pHeight, cy + SEARCH_RADIUS);

                for (let y = minY; y < maxY; y++) {
                    for (let x = minX; x < maxX; x++) {
                        const idx = y * pWidth + x;
                        if (visited[idx] === 1) {
                            sumX += x;
                            sumY += y;
                            count++;
                        }
                    }
                }

                if (count > 0) {
                    currentPos = { x: sumX / count, y: sumY / count };
                } else {
                    tracing = false;
                }
            }

            if (strokePoints.length > 3) {
                rawStrokes.push({ points: strokePoints });
            }
        }
        
        const orderedStrokes = optimizeStrokeOrder(rawStrokes);
        
        const mergedStrokes: Stroke[] = [];
        if (orderedStrokes.length > 0) {
            let currentStroke = orderedStrokes[0];
            const MERGE_THRESHOLD_SQ = 300 * 300; 

            for (let i = 1; i < orderedStrokes.length; i++) {
                const nextStroke = orderedStrokes[i];
                const lastPt = currentStroke.points[currentStroke.points.length - 1];
                const firstPt = nextStroke.points[0];
                
                if (distSq(lastPt, firstPt) < MERGE_THRESHOLD_SQ) {
                     currentStroke.points = currentStroke.points.concat(nextStroke.points);
                } else {
                     mergedStrokes.push(currentStroke);
                     currentStroke = nextStroke;
                }
            }
            mergedStrokes.push(currentStroke);
        }

        const smoothedStrokes = mergedStrokes.map(stroke => {
            let pts = stroke.points;
            // Apply lighter smoothing to merged points
            pts = smoothPoints(pts);
            return { ...stroke, points: pts };
        });

        const finalStrokes: Stroke[] = [];
        
        for (const stroke of smoothedStrokes) {
            const deduped = stroke.points.filter((p, i, arr) => {
                 if (i === 0) return true;
                 const prev = arr[i-1];
                 return distSq(p, prev) > 100;
            });
            
            if (deduped.length < 3) continue;

            const onInkPoints: RawPoint[] = [];
            if (deduped.length > 0) onInkPoints.push(deduped[0]);

            for (let i = 1; i < deduped.length - 1; i++) {
                const p = deduped[i];
                const cx = Math.floor((p.x / OUTPUT_SCALE) * pWidth);
                const cy = Math.floor((p.y / OUTPUT_SCALE) * pHeight);
                
                let hit = false;
                for(let ry = -2; ry <= 2; ry++) {
                    for(let rx = -2; rx <= 2; rx++) {
                        const idx = (cy + ry) * pWidth + (cx + rx);
                        if (idx >= 0 && idx < visited.length && visited[idx] > 0) {
                            hit = true;
                            break;
                        }
                    }
                    if(hit) break;
                }
                
                if (hit) onInkPoints.push(p);
            }
            if (deduped.length > 1) onInkPoints.push(deduped[deduped.length - 1]);

            const jitterFreePoints = filterJitter(onInkPoints);
            if (jitterFreePoints.length < 3) continue;

            const finalPoints = [jitterFreePoints[0]];
            
            // --- SIMPLIFICATION (Douglas-Peucker-ish) ---
            for (let i = 1; i < jitterFreePoints.length - 1; i++) {
                const prev = finalPoints[finalPoints.length - 1];
                const curr = jitterFreePoints[i];
                const next = jitterFreePoints[i+1];

                const area = Math.abs(0.5 * (prev.x * (curr.y - next.y) + curr.x * (next.y - prev.y) + next.x * (prev.y - curr.y)));
                const dx = next.x - prev.x;
                const dy = next.y - prev.y;
                const baseSq = dx*dx + dy*dy;

                if (baseSq < 1) continue;
                const deviationSq = (4 * area * area) / baseSq;
                
                // Lower threshold to 30 to keep more detail (was 70)
                if (deviationSq > 30) {
                    finalPoints.push(curr);
                }
            }
            finalPoints.push(jitterFreePoints[jitterFreePoints.length - 1]);
            
            const candidateStroke = { ...stroke, points: finalPoints };
            if (validateStrokeCoverage(candidateStroke, visited, pWidth, pHeight, OUTPUT_SCALE)) {
                 finalStrokes.push(candidateStroke);
            }
        }

        resolve({
            strokes: finalStrokes,
            metadata: {
                original_size: [img.width, img.height],
                notes: `Local Bitmask Tracer (Scale: ${scale.toFixed(2)}, w/ Ink Thickness & Opacity, Geometry Refined)`
            }
        });

      } catch (e) {
        reject(e);
      }
    };
    
    img.onerror = (e) => reject(new Error("Failed to load image for local tracing"));
    img.src = imageSrc;
  });
};
