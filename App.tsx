import React, { useState, useEffect, useRef } from 'react';
import { PenTool, Wand2, Search, Play, X, Download, MessageSquare, BrainCircuit, Settings2, Video, Activity, Eye, EyeOff, AlertTriangle, Cpu, Layers, Trash2, CheckCircle2, Palette, PaintBucket, MoveVertical, Timer, Split, Volume2, VolumeX, FileVideo, FileType } from 'lucide-react';
import { AppMode, SignatureAnalysis, HandwritingStyle, HandwritingStyleKey } from './types';
import { refineSignature, editSignature, generateRapidInsight } from './services/geminiService';
import { analyzeSignatureLocal } from './services/localTracer';
import { DropZone } from './components/DropZone';
import { CanvasAnimator, CanvasAnimatorHandle } from './components/CanvasAnimator';
import { ExportFormat } from './services/animationEngine';

const PRESETS: Record<HandwritingStyleKey, HandwritingStyle> = {
  smooth_cursive: {
    label: "Smooth Cursive",
    speed_multiplier: 1.25,
    base_ms_per_px: 0.9,
    easing_start: "easeOutCubic",
    easing_end: "easeInOutCubic",
    pressure_curve: "soft-peaked",
    pressure_scale: 1.0, 
    micro_tremor_amp_px: 0.2,
    micro_tremor_freq_hz: 5,
    overshoot_intensity: 0.2,
    ink_spread: "light",
    slant_angle_deg: 14,
    inertia_factor: 1.3,
    connection_smoothing: "high"
  },
  rigid_formal: {
    label: "Rigid Formal",
    speed_multiplier: 0.65,
    base_ms_per_px: 1.6,
    easing_start: "easeInQuad",
    easing_end: "easeOutCubic",
    pressure_curve: "triangular",
    pressure_scale: 1.0, 
    micro_tremor_amp_px: 0.2,
    micro_tremor_freq_hz: 5,
    overshoot_intensity: 0.05,
    ink_spread: "medium",
    slant_angle_deg: 2,
    inertia_factor: 0.7,
    connection_smoothing: "low"
  },
  flowing_dynamic: {
    label: "Flowing Dynamic",
    speed_multiplier: 1.5,
    base_ms_per_px: 0.75,
    easing_start: "easeOutBack",
    easing_end: "easeInOutBack",
    pressure_curve: "waveform",
    pressure_scale: 1.2, 
    micro_tremor_amp_px: 0.2,
    micro_tremor_freq_hz: 5,
    overshoot_intensity: 0.35,
    ink_spread: "heavy",
    slant_angle_deg: 18,
    inertia_factor: 1.6,
    connection_smoothing: "extreme"
  }
};

interface SignatureItem {
  id: string;
  original: string;
  processed: string | null;
  selectedSource: 'original' | 'refined';
  analysis: SignatureAnalysis | null;
  status: 'idle' | 'refining' | 'analyzing' | 'editing' | 'success' | 'error';
  error?: string;
  timestamp: number;
}

function App() {
  const [items, setItems] = useState<SignatureItem[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);

  // View State
  const [isAnimating, setIsAnimating] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [showStrokeOrder, setShowStrokeOrder] = useState(false);
  const [showDownloadModal, setShowDownloadModal] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  
  // Appearance State
  const [strokeColor, setStrokeColor] = useState<string>('#111111');
  const [bgColor, setBgColor] = useState<string>('#fdfbf7');
  const [thickness, setThickness] = useState<number>(0.8);
  const [isSoundEnabled, setIsSoundEnabled] = useState(true);
  
  // Preset State
  const [selectedPresetKey, setSelectedPresetKey] = useState<HandwritingStyleKey>('smooth_cursive');
  const [inertiaFactor, setInertiaFactor] = useState<number>(PRESETS['smooth_cursive'].inertia_factor);
  const [tremorAmp, setTremorAmp] = useState<number>(PRESETS['smooth_cursive'].micro_tremor_amp_px);
  const [tremorFreq, setTremorFreq] = useState<number>(PRESETS['smooth_cursive'].micro_tremor_freq_hz);
  
  // Timing State
  const [duration, setDuration] = useState<number>(2.0);

  const animatorRef = useRef<CanvasAnimatorHandle>(null);

  useEffect(() => {
    const preset = PRESETS[selectedPresetKey];
    setInertiaFactor(preset.inertia_factor);
    setTremorAmp(preset.micro_tremor_amp_px);
    setTremorFreq(preset.micro_tremor_freq_hz);
  }, [selectedPresetKey]);

  const activePreset: HandwritingStyle = {
    ...PRESETS[selectedPresetKey],
    inertia_factor: inertiaFactor,
    micro_tremor_amp_px: tremorAmp,
    micro_tremor_freq_hz: tremorFreq
  };

  const activeItem = items.find(i => i.id === activeId) || null;
  const isLoading = activeItem && ['refining', 'analyzing', 'editing'].includes(activeItem.status);

  // Helper: Get the actual image string based on selection
  const getActiveImage = (item: SignatureItem) => {
    if (item.selectedSource === 'refined' && item.processed) {
        return item.processed;
    }
    return item.original;
  };

  const updateItem = (id: string, updates: Partial<SignatureItem>) => {
    setItems(prev => prev.map(item => item.id === id ? { ...item, ...updates } : item));
  };

  const handleSourceSelect = (id: string, source: 'original' | 'refined') => {
      const item = items.find(i => i.id === id);
      if (item && item.selectedSource !== source) {
          updateItem(id, { 
              selectedSource: source, 
              analysis: null, 
              status: 'idle',
              error: undefined
          });
          setIsAnimating(false);
      }
  };

  const handleImagesSelected = (base64s: string[]) => {
    const newItems: SignatureItem[] = base64s.map(img => ({
      id: Math.random().toString(36).substring(2, 9),
      timestamp: Date.now(),
      original: img,
      processed: null,
      selectedSource: 'original',
      analysis: null,
      status: 'idle'
    }));
    
    setItems(prev => [...prev, ...newItems]);
    if (!activeId && newItems.length > 0) {
      setActiveId(newItems[0].id);
      setIsAnimating(false);
    }
  };

  const handleRemoveItem = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    setItems(prev => {
        const next = prev.filter(i => i.id !== id);
        if (activeId === id) {
            setActiveId(next.length > 0 ? next[0].id : null);
        }
        return next;
    });
  };

  const handleRefine = async () => {
    if (!activeItem) return;
    updateItem(activeItem.id, { status: 'refining', error: undefined });
    try {
      const result = await refineSignature(activeItem.original);
      updateItem(activeItem.id, { 
          processed: result.imageUrl, 
          selectedSource: 'refined', 
          analysis: null, 
          status: 'idle' 
      });
    } catch (err) {
      updateItem(activeItem.id, { 
          status: 'error', 
          error: err instanceof Error ? err.message : "Failed to refine" 
      });
    }
  };

  const performAnalysis = async (item: SignatureItem) => {
      updateItem(item.id, { status: 'analyzing', error: undefined });
      try {
        const imgToAnalyze = getActiveImage(item);
        const result = await analyzeSignatureLocal(imgToAnalyze);
        
        generateRapidInsight(imgToAnalyze).then(insight => {
             updateItem(item.id, {
                analysis: {
                    ...result,
                    metadata: {
                        ...result.metadata,
                        notes: `${result.metadata.notes}. AI Insight: ${insight}`
                    }
                }
             });
        }).catch(console.warn);

        updateItem(item.id, { 
            analysis: result, 
            status: 'success' 
        });
      } catch (err) {
         updateItem(item.id, { 
            status: 'error', 
            error: err instanceof Error ? err.message : "Failed to analyze" 
         });
      }
  };

  const handleAnalyze = async () => {
    if (!activeItem) return;
    await performAnalysis(activeItem);
  };

  const handleAnalyzeAll = async () => {
    for (const item of items) {
        if (!item.analysis) {
            await performAnalysis(item);
        }
    }
  };

  const handleEdit = async () => {
    if (!activeItem || !prompt.trim()) return;
    updateItem(activeItem.id, { status: 'editing', error: undefined });
    try {
      const imgToEdit = getActiveImage(activeItem);
      const result = await editSignature(imgToEdit, prompt);
      updateItem(activeItem.id, { 
          processed: result,
          selectedSource: 'refined',
          analysis: null,
          status: 'idle' 
      });
      setPrompt("");
    } catch (err) {
      updateItem(activeItem.id, { 
          status: 'error', 
          error: err instanceof Error ? err.message : "Failed to edit" 
      });
    }
  };

  const handleAnimate = () => {
    if (!activeItem) return;
    setIsAnimating(true);
    setShowStrokeOrder(false);
  };

  const handleDownloadImage = () => {
    if (!activeItem) return;
    const img = getActiveImage(activeItem);
    const link = document.createElement('a');
    link.href = img;
    link.download = `sigmotion-${activeItem.id}-${activeItem.selectedSource}.png`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const triggerExport = (format: ExportFormat) => {
    if (animatorRef.current) {
        setIsExporting(true);
        setShowDownloadModal(false);
        animatorRef.current.exportAnimation(format);
    }
  };

  const handleVideoGenerated = (url: string) => {
      // If we are in exporting state, download the file
      if (isExporting) {
        const link = document.createElement('a');
        link.href = url;
        const ext = url.includes('gif') ? 'gif' : 'mp4';
        link.download = `signature_animation_${activeItem?.id}.${ext}`; 
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        setIsExporting(false);
      }
  };

  return (
    <div className="min-h-screen bg-background text-slate-200 font-sans selection:bg-primary/30 relative">
      
      {/* Download Modal */}
      {showDownloadModal && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-sm animate-in fade-in duration-200">
              <div className="bg-surface border border-white/10 rounded-2xl p-6 w-full max-w-sm shadow-2xl relative">
                  <button 
                    onClick={() => setShowDownloadModal(false)}
                    className="absolute top-4 right-4 text-gray-400 hover:text-white"
                  >
                      <X className="w-5 h-5" />
                  </button>
                  
                  <h3 className="text-xl font-bold mb-1">Download Animation</h3>
                  <p className="text-sm text-secondary mb-6">Select your preferred format</p>
                  
                  <div className="space-y-3">
                      <button 
                        onClick={() => triggerExport('mp4')}
                        className="w-full flex items-center gap-4 p-4 rounded-xl bg-white/5 hover:bg-white/10 border border-white/5 transition-colors group"
                      >
                          <div className="p-2 bg-blue-500/20 rounded-lg text-blue-400 group-hover:scale-110 transition-transform">
                              <Volume2 className="w-5 h-5" />
                          </div>
                          <div className="text-left">
                              <div className="font-semibold text-gray-200">MP4 with Audio</div>
                              <div className="text-xs text-gray-500">Video + Pen Sounds</div>
                          </div>
                      </button>

                      <button 
                        onClick={() => triggerExport('mp4-silent')}
                        className="w-full flex items-center gap-4 p-4 rounded-xl bg-white/5 hover:bg-white/10 border border-white/5 transition-colors group"
                      >
                          <div className="p-2 bg-purple-500/20 rounded-lg text-purple-400 group-hover:scale-110 transition-transform">
                              <VolumeX className="w-5 h-5" />
                          </div>
                          <div className="text-left">
                              <div className="font-semibold text-gray-200">MP4 No Audio</div>
                              <div className="text-xs text-gray-500">Silent Video</div>
                          </div>
                      </button>

                      <button 
                        onClick={() => triggerExport('gif')}
                        className="w-full flex items-center gap-4 p-4 rounded-xl bg-white/5 hover:bg-white/10 border border-white/5 transition-colors group"
                      >
                          <div className="p-2 bg-green-500/20 rounded-lg text-green-400 group-hover:scale-110 transition-transform">
                              <FileType className="w-5 h-5" />
                          </div>
                          <div className="text-left">
                              <div className="font-semibold text-gray-200">GIF</div>
                              <div className="text-xs text-gray-500">Animated Image</div>
                          </div>
                      </button>
                  </div>
              </div>
          </div>
      )}

      {/* Header */}
      <header className="border-b border-surface bg-background/80 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-gradient-to-br from-primary to-blue-600 rounded-lg shadow-lg shadow-primary/20">
              <PenTool className="w-6 h-6 text-white" />
            </div>
            <h1 className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-white to-slate-400">
              SigMotion
            </h1>
          </div>
          <div className="flex gap-4 text-sm text-secondary font-medium">
             <span className="flex items-center gap-1"><BrainCircuit className="w-3 h-3" /> Nano-Banana</span>
             <span className="text-surface border-l border-surface mx-2"></span>
             <span className="flex items-center gap-1"><Cpu className="w-3 h-3" /> Bitmask Tracer</span>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto p-4 lg:p-8">
        
        {/* Queue / Batch Bar */}
        {items.length > 0 && (
          <div className="mb-6 flex gap-4 overflow-x-auto pb-4 scrollbar-thin">
             {items.map(item => (
                 <div 
                    key={item.id}
                    onClick={() => { setActiveId(item.id); setIsAnimating(false); }}
                    className={`relative flex-shrink-0 w-24 h-24 rounded-xl border-2 overflow-hidden cursor-pointer transition-all group ${
                        activeId === item.id ? 'border-primary shadow-[0_0_15px_rgba(59,130,246,0.3)]' : 'border-surface hover:border-white/20'
                    }`}
                 >
                    <img src={getActiveImage(item)} className="w-full h-full object-cover" />
                    <div className="absolute top-1 right-1 flex gap-1">
                        {item.status === 'success' && <div className="bg-green-500/80 p-1 rounded-full"><CheckCircle2 className="w-3 h-3 text-white"/></div>}
                        {item.status === 'error' && <div className="bg-red-500/80 p-1 rounded-full"><AlertTriangle className="w-3 h-3 text-white"/></div>}
                        {['refining','analyzing','editing'].includes(item.status) && (
                            <div className="w-4 h-4 rounded-full border-2 border-primary border-t-transparent animate-spin bg-black/50"></div>
                        )}
                    </div>
                    <button 
                        onClick={(e) => handleRemoveItem(e, item.id)}
                        className="absolute bottom-1 right-1 p-1 bg-black/50 hover:bg-red-500/80 rounded-lg opacity-0 group-hover:opacity-100 transition-all"
                    >
                        <Trash2 className="w-3 h-3 text-white" />
                    </button>
                 </div>
             ))}
             <div className="flex-shrink-0 w-24 h-24">
                 <DropZone onImagesSelected={handleImagesSelected} compact={true} />
             </div>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 min-h-[600px]">
          
          {/* Left Column: Input */}
          <div className="space-y-6">
            <div className="bg-surface/30 rounded-3xl p-6 border border-white/5 backdrop-blur-sm shadow-xl">
              <div className="flex justify-between items-center mb-4">
                  <h2 className="text-lg font-semibold flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-primary"></span>
                    Original Input {items.length > 0 && `(${items.length})`}
                  </h2>
                  
                  {items.length > 1 && (
                      <button 
                        onClick={handleAnalyzeAll}
                        disabled={items.some(i => i.status === 'analyzing')}
                        className="text-xs flex items-center gap-2 bg-purple-500/20 hover:bg-purple-500/30 text-purple-300 px-3 py-1.5 rounded-lg border border-purple-500/30 transition-colors"
                      >
                          <Layers className="w-3 h-3" /> Process Batch
                      </button>
                  )}
              </div>
              
              {!activeItem ? (
                <DropZone onImagesSelected={handleImagesSelected} />
              ) : (
                <div className="space-y-4">
                   {activeItem.processed ? (
                      <div className="grid grid-cols-2 gap-4">
                          <div 
                              onClick={() => handleSourceSelect(activeItem.id, 'original')}
                              className={`relative group cursor-pointer rounded-xl border-2 transition-all overflow-hidden ${
                                activeItem.selectedSource === 'original' 
                                  ? 'border-primary shadow-[0_0_20px_rgba(59,130,246,0.2)]' 
                                  : 'border-white/10 hover:border-white/30 opacity-60 hover:opacity-100'
                              }`}
                          >
                              <div className="absolute top-2 left-2 z-10 bg-black/70 backdrop-blur px-2 py-0.5 rounded text-[10px] font-mono uppercase tracking-wider text-gray-300">
                                Original
                              </div>
                              {activeItem.selectedSource === 'original' && (
                                <div className="absolute top-2 right-2 z-10 bg-primary rounded-full p-0.5">
                                    <CheckCircle2 className="w-3 h-3 text-white"/>
                                </div>
                              )}
                              <img src={activeItem.original} className="w-full h-40 object-contain bg-white/5" />
                          </div>

                          <div 
                              onClick={() => handleSourceSelect(activeItem.id, 'refined')}
                              className={`relative group cursor-pointer rounded-xl border-2 transition-all overflow-hidden ${
                                activeItem.selectedSource === 'refined' 
                                  ? 'border-primary shadow-[0_0_20px_rgba(59,130,246,0.2)]' 
                                  : 'border-white/10 hover:border-white/30 opacity-60 hover:opacity-100'
                              }`}
                          >
                              <div className="absolute top-2 left-2 z-10 bg-blue-600/90 backdrop-blur px-2 py-0.5 rounded text-[10px] font-mono uppercase tracking-wider text-white shadow-lg">
                                Refined
                              </div>
                              {activeItem.selectedSource === 'refined' && (
                                <div className="absolute top-2 right-2 z-10 bg-primary rounded-full p-0.5">
                                    <CheckCircle2 className="w-3 h-3 text-white"/>
                                </div>
                              )}
                              <img src={activeItem.processed} className="w-full h-40 object-contain bg-white/5" />
                          </div>
                      </div>
                   ) : (
                      <div className="relative group">
                        <img 
                            src={activeItem.original} 
                            alt="Original" 
                            className="w-full h-64 object-contain bg-white rounded-xl border border-secondary/20" 
                        />
                        <div className="absolute top-2 left-2 bg-black/60 backdrop-blur-md px-2 py-1 rounded-md text-xs font-mono text-gray-300">
                            ID: {activeItem.id}
                        </div>
                      </div>
                   )}
                   
                   {activeItem.processed && (
                       <div className="text-xs text-center text-secondary flex items-center justify-center gap-2">
                           <Split className="w-3 h-3" /> Select image to use for animation
                       </div>
                   )}
                </div>
              )}
            </div>

            <div className={`bg-surface rounded-3xl p-6 border border-white/5 shadow-xl space-y-4 ${!activeItem ? 'opacity-50 pointer-events-none' : ''}`}>
              <h2 className="text-lg font-semibold flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-accent"></span>
                Pipeline Controls
              </h2>
              
              <div className="grid grid-cols-2 gap-3">
                <button
                  onClick={handleRefine}
                  disabled={!activeItem || isLoading}
                  className="flex items-center justify-center gap-2 p-4 rounded-xl bg-blue-600/10 hover:bg-blue-600/20 text-blue-400 border border-blue-600/20 transition-all disabled:opacity-50 disabled:cursor-not-allowed group"
                >
                  <Wand2 className="w-5 h-5 group-hover:rotate-12 transition-transform" />
                  <div className="text-left">
                    <div className="font-semibold">Refine Image</div>
                    <div className="text-xs opacity-70">with Nano-Banana</div>
                  </div>
                </button>

                <button
                  onClick={handleAnalyze}
                  disabled={!activeItem || isLoading}
                  className="flex items-center justify-center gap-2 p-4 rounded-xl bg-purple-600/10 hover:bg-purple-600/20 text-purple-400 border border-purple-600/20 transition-all disabled:opacity-50 disabled:cursor-not-allowed group"
                >
                  <Search className="w-5 h-5 group-hover:scale-110 transition-transform" />
                  <div className="text-left">
                    <div className="font-semibold">Generate Animation</div>
                    <div className="text-xs opacity-70">Bitmask Tracer</div>
                  </div>
                </button>
              </div>

              <div className="pt-2">
                <label className="text-sm text-secondary mb-2 block">Manual AI Edit (Prompt)</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    placeholder="e.g., 'Make the ink blue' or 'Add a retro filter'"
                    className="flex-1 bg-background/50 border border-white/10 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-primary/50 transition-colors placeholder:text-gray-600"
                  />
                  <button
                    onClick={handleEdit}
                    disabled={!activeItem || !prompt || isLoading}
                    className="p-3 bg-surface hover:bg-primary text-white rounded-xl border border-white/10 hover:border-primary transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <MessageSquare className="w-5 h-5" />
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Right Column: Output */}
          <div className="space-y-6">
            <div className="bg-surface/30 rounded-3xl p-6 border border-white/5 backdrop-blur-sm shadow-xl min-h-[400px] flex flex-col">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-green-500"></span>
                  Visual Result
                </h2>
                <div className="flex gap-2">
                  {/* Sound Toggle */}
                  {activeItem && (
                     <button
                        onClick={() => setIsSoundEnabled(!isSoundEnabled)}
                        className={`p-2 rounded-lg transition-colors border ${
                           isSoundEnabled 
                           ? 'bg-white/10 text-white border-white/10' 
                           : 'text-gray-500 border-transparent hover:text-gray-300'
                        }`}
                        title={isSoundEnabled ? "Mute Pen Sound" : "Enable Pen Sound"}
                     >
                        {isSoundEnabled ? <Volume2 className="w-4 h-4"/> : <VolumeX className="w-4 h-4"/>}
                     </button>
                  )}

                  {activeItem?.analysis && (
                    <button
                      onClick={() => setShowStrokeOrder(!showStrokeOrder)}
                      className={`flex items-center gap-2 px-3 py-2 rounded-lg transition-colors border ${
                        showStrokeOrder 
                          ? 'bg-purple-600/20 text-purple-400 border-purple-600/20' 
                          : 'hover:bg-white/10 text-gray-400 border-transparent'
                      }`}
                      title="Visualize Stroke Order"
                    >
                      {showStrokeOrder ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
                    </button>
                  )}

                  {activeItem && (
                    <>
                    <button
                      onClick={handleAnimate}
                      disabled={isAnimating || isLoading || !activeItem.analysis}
                      className="flex items-center gap-2 px-4 py-2 bg-green-600/20 hover:bg-green-600/30 text-green-400 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed border border-green-600/20"
                      title="Run Physics Animation"
                    >
                      <Play className="w-4 h-4" />
                      <span className="text-sm font-medium">Animate</span>
                    </button>
                    
                    {/* Download Button (Triggers Modal) */}
                    <button
                        onClick={() => setShowDownloadModal(true)}
                        disabled={!activeItem.analysis}
                        className="flex items-center gap-2 px-4 py-2 bg-blue-600/20 hover:bg-blue-600/30 text-blue-400 rounded-lg transition-colors border border-blue-600/20"
                        title="Download Options"
                      >
                        <Video className="w-4 h-4" />
                    </button>

                    <button
                      onClick={handleDownloadImage}
                      className="p-2 hover:bg-white/10 rounded-lg transition-colors text-gray-300"
                      title="Download Image"
                    >
                      <Download className="w-5 h-5" />
                    </button>
                    </>
                  )}
                </div>
              </div>

              {activeItem?.analysis && (
                <div className="mb-4 space-y-4">
                  <div className="bg-black/20 p-2 rounded-xl flex gap-1">
                    {(Object.keys(PRESETS) as HandwritingStyleKey[]).map((key) => (
                      <button
                        key={key}
                        onClick={() => { setSelectedPresetKey(key); }}
                        disabled={isAnimating}
                        className={`flex-1 py-2 px-3 rounded-lg text-xs font-medium transition-all ${
                          selectedPresetKey === key
                            ? 'bg-primary text-white shadow-lg shadow-primary/20'
                            : 'text-secondary hover:bg-white/5 hover:text-white'
                        }`}
                      >
                        {PRESETS[key].label}
                      </button>
                    ))}
                  </div>

                  <div className="grid grid-cols-2 gap-4 px-2">
                     <div className="space-y-3">
                         <div className="text-xs text-secondary font-semibold uppercase tracking-wider mb-2 flex items-center gap-1">
                             <Palette className="w-3 h-3" /> Appearance
                         </div>
                         
                         <div className="flex gap-4">
                             <div>
                                 <label className="text-[10px] text-gray-500 mb-1 block">Ink Color</label>
                                 <div className="relative w-8 h-8 rounded-full overflow-hidden border border-white/20 cursor-pointer hover:scale-110 transition-transform">
                                    <input 
                                        type="color" 
                                        value={strokeColor}
                                        onChange={(e) => { setStrokeColor(e.target.value); }}
                                        className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[150%] h-[150%] p-0 border-0 cursor-pointer"
                                    />
                                 </div>
                             </div>
                             <div>
                                 <label className="text-[10px] text-gray-500 mb-1 block">Paper Color</label>
                                 <div className="relative w-8 h-8 rounded-full overflow-hidden border border-white/20 cursor-pointer hover:scale-110 transition-transform">
                                    <input 
                                        type="color" 
                                        value={bgColor}
                                        onChange={(e) => { setBgColor(e.target.value); }}
                                        className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[150%] h-[150%] p-0 border-0 cursor-pointer"
                                    />
                                 </div>
                             </div>
                         </div>

                         <div>
                            <div className="flex justify-between text-xs text-gray-400 mb-1">
                                <span className="flex items-center gap-1"><MoveVertical className="w-3 h-3" /> Thickness</span>
                                <span className="font-mono text-white">{thickness.toFixed(1)}x</span>
                            </div>
                            <input
                                type="range"
                                min="0.1"
                                max="3.0"
                                step="0.1"
                                value={thickness}
                                onChange={(e) => { setThickness(parseFloat(e.target.value)); }}
                                disabled={isAnimating}
                                className="w-full h-1.5 bg-surface rounded-lg appearance-none cursor-pointer accent-white hover:accent-gray-200"
                            />
                         </div>
                     </div>

                     <div className="space-y-3 border-l border-white/5 pl-4">
                         <div className="text-xs text-secondary font-semibold uppercase tracking-wider mb-2 flex items-center gap-1">
                             <Settings2 className="w-3 h-3" /> Physics
                         </div>

                        <div>
                         <div className="flex justify-between text-xs text-gray-400 mb-1">
                          <span className="flex items-center gap-1">Inertia</span>
                          <span className="font-mono text-white">{inertiaFactor.toFixed(1)}x</span>
                        </div>
                        <input
                          type="range"
                          min="0"
                          max="5"
                          step="0.1"
                          value={inertiaFactor}
                          onChange={(e) => { setInertiaFactor(parseFloat(e.target.value)); }}
                          disabled={isAnimating}
                          className="w-full h-1.5 bg-surface rounded-lg appearance-none cursor-pointer accent-primary hover:accent-primary/80"
                        />
                       </div>

                       <div>
                         <div className="flex justify-between text-xs text-gray-400 mb-1">
                          <span className="flex items-center gap-1"><Timer className="w-3 h-3"/> Duration</span>
                          <span className="font-mono text-white">{duration.toFixed(1)}s</span>
                        </div>
                        <input
                          type="range"
                          min="0.5"
                          max="10.0"
                          step="0.5"
                          value={duration}
                          onChange={(e) => { setDuration(parseFloat(e.target.value)); }}
                          disabled={isAnimating}
                          className="w-full h-1.5 bg-surface rounded-lg appearance-none cursor-pointer accent-purple-500 hover:accent-purple-400"
                        />
                       </div>
                     </div>
                  </div>
                </div>
              )}

              <div className="flex-1 flex items-center justify-center bg-background/50 rounded-2xl border border-dashed border-white/10 overflow-hidden relative">
                
                {isExporting && (
                    <div className="absolute inset-0 z-20 bg-black/80 flex flex-col items-center justify-center animate-in fade-in">
                        <div className="w-10 h-10 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mb-3"></div>
                        <span className="text-sm font-medium text-blue-200 animate-pulse">Generating File...</span>
                    </div>
                )}

                {isLoading ? (
                  <div className="flex flex-col items-center gap-4 animate-pulse">
                    <div className="w-12 h-12 border-4 border-primary border-t-transparent rounded-full animate-spin"></div>
                    <div className="text-sm text-secondary">
                        {activeItem?.status === 'refining' && "Refining Image..."}
                        {activeItem?.status === 'analyzing' && "Tracing Ink Geometry..."}
                        {activeItem?.status === 'editing' && "Applying Generative Edits..."}
                    </div>
                  </div>
                ) : (
                  (activeItem) ? (
                    <CanvasAnimator
                      ref={animatorRef}
                      imageSrc={getActiveImage(activeItem)}
                      isAnimating={isAnimating}
                      soundEnabled={isSoundEnabled}
                      visualizeStrokeOrder={showStrokeOrder}
                      analysisData={activeItem.analysis}
                      preset={activePreset}
                      strokeColor={strokeColor}
                      bgColor={bgColor}
                      thicknessScale={thickness}
                      animationDuration={duration}
                      onAnimationComplete={() => setIsAnimating(false)}
                      onVideoGenerated={handleVideoGenerated}
                      className="w-full h-full min-h-[300px]"
                    />
                  ) : (
                    <div className="text-secondary text-center">
                      <p>No image selected</p>
                      <p className="text-xs opacity-50 mt-1">Upload an image to start</p>
                    </div>
                  )
                )}
              </div>
            </div>
            
            {activeItem?.analysis && (
               <div className="bg-surface rounded-3xl p-6 border border-white/5 shadow-xl animate-in fade-in slide-in-from-bottom-4 duration-500">
                  <h3 className="text-md font-semibold text-purple-400 mb-3 flex items-center gap-2">
                    <Search className="w-4 h-4" />
                    Bitmask Trace Data
                  </h3>
                  <div className="grid grid-cols-2 gap-4 text-xs text-gray-400 font-mono">
                    <div className="p-3 bg-background/50 rounded-lg">
                        <span className="block text-secondary mb-1">Stroke Segments</span>
                        <span className="text-lg text-white font-bold">{activeItem.analysis.strokes.length}</span>
                    </div>
                     <div className="p-3 bg-background/50 rounded-lg">
                        <span className="block text-secondary mb-1">Trace Points</span>
                        <span className="text-lg text-white font-bold">
                            {activeItem.analysis.strokes.reduce((acc, s) => acc + s.points.length, 0)}
                        </span>
                    </div>
                  </div>
                  <div className="mt-4 pt-4 border-t border-white/5">
                      <div className="text-xs text-secondary mb-2">Active Physics Settings</div>
                      <div className="grid grid-cols-2 gap-y-1 text-sm font-mono text-accent">
                          <span>Preset:</span> <span className="text-right opacity-70">{PRESETS[selectedPresetKey].label}</span>
                          <span>Inertia:</span> <span className="text-right opacity-70">{inertiaFactor.toFixed(1)}x</span>
                          <span>Tremor:</span> <span className="text-right opacity-70">{tremorAmp.toFixed(2)}px</span>
                      </div>
                      <div className="mt-2 text-xs text-gray-400 italic border-t border-white/5 pt-2">
                          {activeItem.analysis.metadata.notes}
                      </div>
                  </div>
               </div>
            )}
            
            {activeItem?.error && (
              <div className="bg-red-500/10 border border-red-500/20 text-red-400 p-4 rounded-xl text-sm flex items-start gap-3 animate-in fade-in slide-in-from-bottom-2">
                <AlertTriangle className="w-5 h-5 flex-shrink-0 mt-0.5" />
                <div className="flex-1">
                    <h4 className="font-semibold text-red-300 mb-1">Process Failed</h4>
                    <p className="opacity-90">{activeItem.error}</p>
                </div>
                <button onClick={() => updateItem(activeItem.id, { error: undefined })} className="p-1 hover:bg-red-500/20 rounded transition-colors text-red-300">
                    <X className="w-4 h-4" />
                </button>
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}

export default App;