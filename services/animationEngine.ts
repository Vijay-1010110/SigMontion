
import { SignatureAnalysis, HandwritingStyle, StrokePath } from '../types';
import { generateMotionPlan } from './motionPlanner';
import { AudioSynth } from './audioSynth';
import { GIFEncoder, quantize, applyPalette } from 'gifenc';

export type ExportFormat = 'mp4' | 'mp4-silent' | 'gif';

export class AnimationEngine {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private image: HTMLImageElement;
  private analysisData: SignatureAnalysis | null;
  private preset: HandwritingStyle | undefined;
  
  // Custom Styles
  private strokeColor: string;
  private bgColor: string;
  private thicknessScale: number;
  private targetDuration: number;

  private onComplete?: () => void;
  private onVideoGenerated?: (url: string) => void;

  private rafId: number | null = null;
  private startTime: number = 0;
  private mediaRecorder: MediaRecorder | null = null;
  private recordedChunks: Blob[] = [];
  private isRecording: boolean = false;
  
  private audioSynth: AudioSynth;
  private soundEnabled: boolean = false;
  private exportFormat: ExportFormat | null = null;
  private gifEncoder: GIFEncoder | null = null;
  private gifFrameDelay: number = 50; // ms

  constructor(
    canvas: HTMLCanvasElement,
    image: HTMLImageElement,
    analysisData: SignatureAnalysis | null,
    preset?: HandwritingStyle,
    strokeColor: string = '#111111',
    bgColor: string = '#fdfbf7',
    thicknessScale: number = 1.0,
    targetDuration: number = 2.0,
    onComplete?: () => void,
    onVideoGenerated?: (url: string) => void
  ) {
    this.canvas = canvas;
    const context = canvas.getContext('2d', { 
      alpha: true, 
      desynchronized: false 
    });
    if (!context) throw new Error("Could not get canvas context");
    this.ctx = context;
    this.image = image;
    this.analysisData = analysisData;
    this.preset = preset;
    
    this.strokeColor = strokeColor;
    this.bgColor = bgColor;
    this.thicknessScale = thicknessScale;
    this.targetDuration = targetDuration;

    this.onComplete = onComplete;
    this.onVideoGenerated = onVideoGenerated;
    
    this.audioSynth = new AudioSynth();
  }

  // Helper to convert HEX to RGB object for opacity injection
  private hexToRgb(hex: string) {
    // Expand shorthand form (e.g. "03F") to full form (e.g. "0033FF")
    const shorthandRegex = /^#?([a-f\d])([a-f\d])([a-f\d])$/i;
    hex = hex.replace(shorthandRegex, function(m, r, g, b) {
        return r + r + g + g + b + b;
    });

    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? {
        r: parseInt(result[1], 16),
        g: parseInt(result[2], 16),
        b: parseInt(result[3], 16)
    } : { r: 17, g: 17, b: 17 }; // Default dark
  }

  public setSoundEnabled(enabled: boolean) {
    this.soundEnabled = enabled;
  }

  public drawDebug() {
    this.stop(); 
    this.fillBackground();

    // Draw faint original for comparison
    this.ctx.save();
    this.ctx.globalAlpha = 0.2;
    this.ctx.drawImage(this.image, 0, 0, this.canvas.width, this.canvas.height);
    this.ctx.restore();

    if (this.analysisData && this.analysisData.strokes) {
        const paths = generateMotionPlan(
          this.analysisData, 
          this.canvas.width, 
          this.canvas.height, 
          this.preset
        );
        
        this.ctx.save();
        this.ctx.lineCap = 'round';
        this.ctx.lineJoin = 'round';

        paths.forEach((path, index) => {
            const { points } = path;
            if (points.length < 2) return;
            
            const hue = (index * 60) % 360;
            const color = `hsl(${hue}, 80%, 40%)`;
            
            this.ctx.beginPath();
            this.ctx.moveTo(points[0].x, points[0].y);
            for (let i = 1; i < points.length; i++) {
                this.ctx.lineTo(points[i].x, points[i].y);
            }
            this.ctx.strokeStyle = color;
            this.ctx.lineWidth = 2;
            this.ctx.stroke();
            
            this.ctx.fillStyle = color;
            for (let i = 0; i < points.length; i+=2) { 
                this.ctx.fillRect(points[i].x - 1, points[i].y - 1, 2, 2);
            }

            const start = points[0];
            this.ctx.beginPath();
            this.ctx.arc(start.x, start.y, 10, 0, Math.PI * 2);
            this.ctx.fillStyle = 'white';
            this.ctx.fill();
            this.ctx.strokeStyle = color;
            this.ctx.stroke();

            this.ctx.fillStyle = color;
            this.ctx.font = 'bold 10px sans-serif';
            this.ctx.textAlign = 'center';
            this.ctx.textBaseline = 'middle';
            this.ctx.fillText(`${index + 1}`, start.x, start.y);
        });
        this.ctx.restore();
    }
  }

  public drawStatic() {
    this.stop(); 
    this.fillBackground();

    this.ctx.save();
    this.ctx.globalAlpha = 0.05; 
    this.ctx.drawImage(this.image, 0, 0, this.canvas.width, this.canvas.height);
    this.ctx.restore();

    if (this.analysisData && this.analysisData.strokes) {
      try {
        const paths = generateMotionPlan(
          this.analysisData, 
          this.canvas.width, 
          this.canvas.height, 
          this.preset
        );
        this.ctx.lineCap = 'round';
        this.ctx.lineJoin = 'round';
        
        this.setupShadows();

        if (paths.length === 0) {
             this.ctx.globalAlpha = 1.0;
             this.ctx.drawImage(this.image, 0, 0, this.canvas.width, this.canvas.height);
             return;
        }

        paths.forEach(path => {
          this.drawPath(path, Number.MAX_SAFE_INTEGER);
        });
      } catch (e) {
        console.warn("Motion plan generation failed", e);
        this.ctx.globalAlpha = 1.0;
        this.ctx.drawImage(this.image, 0, 0, this.canvas.width, this.canvas.height);
      }
    } else {
      this.ctx.globalAlpha = 1.0;
      this.ctx.drawImage(this.image, 0, 0, this.canvas.width, this.canvas.height);
    }
  }

  // Allow triggering a specific export format
  public start(exportFormat: ExportFormat | null = null) {
    this.stop();
    this.exportFormat = exportFormat;

    let paths: StrokePath[] = [];
    if (this.analysisData && this.analysisData.strokes) {
      try {
        paths = generateMotionPlan(
          this.analysisData, 
          this.canvas.width, 
          this.canvas.height, 
          this.preset
        );
      } catch (e) {
        paths = [];
      }
    }

    // Scale paths
    if (paths.length > 0) {
        const naturalDuration = paths[paths.length - 1].endTime;
        if (naturalDuration > 0) {
            const targetMs = this.targetDuration * 1000;
            const ratio = targetMs / naturalDuration;
            paths.forEach(path => {
                path.startTime *= ratio;
                path.endTime *= ratio;
                path.points.forEach(p => p.time *= ratio);
            });
        }
    }

    const animationEndTime = paths.length > 0 ? paths[paths.length - 1].endTime : 2000;
    const loopDuration = animationEndTime + 1000;

    this.fillBackground();

    // Start Audio
    if (this.soundEnabled || exportFormat === 'mp4') {
        this.audioSynth.start();
    }

    // Initialize Recording
    if (exportFormat === 'mp4' || exportFormat === 'mp4-silent') {
        this.setupVideoRecording(exportFormat === 'mp4'); // Pass true if audio needed
        setTimeout(() => this.startVideoRecording(), 50);
    } else if (exportFormat === 'gif') {
        this.setupGifRecording();
    }

    this.startTime = performance.now();
    let lastGifCapture = 0;
    
    const loop = (now: number) => {
      const elapsed = now - this.startTime;
      this.fillBackground();
      this.setupContextDefaults();
      this.setupShadows();

      let isMoving = false;
      let currentSpeed = 0;

      if (paths.length > 0) {
        paths.forEach(path => {
          if (elapsed >= path.startTime) {
             const { moving, speed } = this.drawPath(path, elapsed);
             if (moving) {
               isMoving = true;
               currentSpeed = speed;
             }
          }
        });
      } else {
        const progress = Math.min(1, elapsed / 2000);
        this.ctx.save();
        this.ctx.beginPath();
        this.ctx.rect(0, 0, this.canvas.width * progress, this.canvas.height);
        this.ctx.clip();
        this.ctx.drawImage(this.image, 0, 0, this.canvas.width, this.canvas.height);
        this.ctx.restore();
      }

      // Audio Modulation
      if (this.soundEnabled || exportFormat === 'mp4') {
         if (isMoving) {
             this.audioSynth.setIntensity(currentSpeed || 1);
         } else {
             this.audioSynth.silence();
         }
      }

      // GIF Capture
      if (exportFormat === 'gif') {
         if (elapsed - lastGifCapture > this.gifFrameDelay) {
             this.captureGifFrame();
             lastGifCapture = elapsed;
         }
      }

      if (elapsed < loopDuration) {
        this.rafId = requestAnimationFrame(loop);
      } else {
        this.finish();
      }
    };

    this.rafId = requestAnimationFrame(loop);
  }

  public stop() {
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    this.stopVideoRecording();
    this.audioSynth.stop();
  }

  private finish() {
    this.stopVideoRecording();
    if (this.exportFormat === 'gif') {
        this.finishGifRecording();
    }
    this.audioSynth.stop();
    this.exportFormat = null;
    if (this.onComplete) this.onComplete();
  }

  private fillBackground() {
    this.ctx.globalCompositeOperation = 'source-over';
    this.ctx.globalAlpha = 1.0;
    this.ctx.fillStyle = this.bgColor; 
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
  }

  private setupContextDefaults() {
    this.ctx.lineCap = 'round';
    this.ctx.lineJoin = 'round';
  }

  private setupShadows() {
    if (this.preset && (this.preset.ink_spread === 'medium' || this.preset.ink_spread === 'heavy')) {
      const { r, g, b } = this.hexToRgb(this.strokeColor);
      this.ctx.shadowBlur = this.preset.ink_spread === 'heavy' ? 2 : 1;
      this.ctx.shadowColor = `rgba(${r}, ${g}, ${b}, 0.4)`;
    } else {
      this.ctx.shadowBlur = 0;
      this.ctx.shadowColor = 'transparent';
    }
  }

  private drawPath(path: StrokePath, elapsedTime: number): { moving: boolean, speed: number } {
    const { points } = path;
    if (!points || points.length < 2) return { moving: false, speed: 0 };

    const { r, g, b } = this.hexToRgb(this.strokeColor);
    let moving = false;
    let speed = 0;

    // Fast static render
    if (elapsedTime >= Number.MAX_SAFE_INTEGER) {
        for (let i = 0; i < points.length - 1; i++) {
           const p1 = points[i];
           const p2 = points[i+1];
           this.ctx.beginPath();
           this.ctx.moveTo(p1.x, p1.y);
           this.ctx.lineTo(p2.x, p2.y);
           this.ctx.lineWidth = p1.lineWidth * this.thicknessScale;
           this.ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, ${p1.opacity})`;
           this.ctx.stroke();
        }
        return { moving: false, speed: 0 };
    }

    // Animated variable width render
    for (let i = 0; i < points.length - 1; i++) {
      const p1 = points[i];
      const p2 = points[i+1];

      if (p1.time > elapsedTime) break;

      let targetX = p2.x;
      let targetY = p2.y;
      const isLeadingSegment = p2.time > elapsedTime;

      if (isLeadingSegment) {
        const segDuration = p2.time - p1.time;
        const progress = segDuration > 0.001 ? (elapsedTime - p1.time) / segDuration : 1;
        targetX = p1.x + (p2.x - p1.x) * progress;
        targetY = p1.y + (p2.y - p1.y) * progress;
        
        moving = true;
        const dist = Math.sqrt((p2.x-p1.x)**2 + (p2.y-p1.y)**2);
        speed = dist / (segDuration || 1); // pixels per ms
      }

      this.ctx.beginPath();
      this.ctx.moveTo(p1.x, p1.y);
      this.ctx.lineTo(targetX, targetY);
      this.ctx.lineWidth = p1.lineWidth * this.thicknessScale; 
      this.ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, ${p1.opacity})`;
      this.ctx.stroke();

      if (isLeadingSegment) break;
    }
    
    return { moving, speed: speed * 10 }; // Scale speed up for synthesis
  }

  // --- MP4 Recording ---
  private setupVideoRecording(withAudio: boolean) {
    try {
      // @ts-ignore
      const canvasStream = this.canvas.captureStream(60) as MediaStream;
      const tracks = [...canvasStream.getVideoTracks()];
      
      if (withAudio && this.audioSynth.destination) {
         const audioTracks = this.audioSynth.destination.stream.getAudioTracks();
         if (audioTracks.length > 0) {
             tracks.push(audioTracks[0]);
         }
      }

      const combinedStream = new MediaStream(tracks);
      
      this.recordedChunks = [];
      const mimeType = MediaRecorder.isTypeSupported('video/mp4; codecs=avc1.42E01E,mp4a.40.2')
        ? 'video/mp4; codecs=avc1.42E01E,mp4a.40.2'
        : 'video/webm';
      
      this.mediaRecorder = new MediaRecorder(combinedStream, { mimeType });
      this.mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) this.recordedChunks.push(e.data);
      };
      this.mediaRecorder.onstop = () => {
        const blob = new Blob(this.recordedChunks, { type: mimeType });
        const url = URL.createObjectURL(blob);
        if (this.onVideoGenerated) this.onVideoGenerated(url);
      };
    } catch (e) { console.warn("Rec failed", e); }
  }

  private startVideoRecording() {
    if (this.mediaRecorder && this.mediaRecorder.state === 'inactive') {
        this.mediaRecorder.start();
        this.isRecording = true;
    }
  }

  private stopVideoRecording() {
    if (this.mediaRecorder && this.mediaRecorder.state === 'recording') {
      this.mediaRecorder.stop();
    }
    this.isRecording = false;
  }

  // --- GIF Recording ---
  private setupGifRecording() {
    this.gifEncoder = GIFEncoder();
  }

  private captureGifFrame() {
    if (!this.gifEncoder) return;
    const { width, height } = this.canvas;
    // Get raw data
    const imageData = this.ctx.getImageData(0, 0, width, height);
    // Quantize
    const palette = quantize(imageData.data, 256);
    const index = applyPalette(imageData.data, palette);
    // Write
    this.gifEncoder.writeFrame(index, width, height, { 
        palette, 
        delay: this.gifFrameDelay 
    });
  }

  private finishGifRecording() {
    if (!this.gifEncoder) return;
    this.gifEncoder.finish();
    const buffer = this.gifEncoder.bytes();
    const blob = new Blob([buffer], { type: 'image/gif' });
    const url = URL.createObjectURL(blob);
    if (this.onVideoGenerated) this.onVideoGenerated(url);
    this.gifEncoder = null;
  }
}
