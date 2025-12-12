

export class AudioSynth {
  private ctx: AudioContext | null = null;
  private gainNode: GainNode | null = null;
  private noiseSource: AudioBufferSourceNode | null = null;
  private filterNode: BiquadFilterNode | null = null;
  // Fix: Correct type name for MediaStreamAudioDestinationNode
  public destination: MediaStreamAudioDestinationNode | null = null;
  private isPlaying: boolean = false;

  constructor() {
    try {
      // Initialize lazily to respect browser autoplay policies
      const AudioCtor = (window.AudioContext || (window as any).webkitAudioContext);
      if (AudioCtor) {
        this.ctx = new AudioCtor();
        this.destination = this.ctx.createMediaStreamDestination();
      }
    } catch (e) {
      console.warn("WebAudio not supported", e);
    }
  }

  private initAudioGraph() {
    if (!this.ctx) return;
    if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }

    // Create White Noise Buffer
    const bufferSize = this.ctx.sampleRate * 2; // 2 seconds loop
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }

    this.noiseSource = this.ctx.createBufferSource();
    this.noiseSource.buffer = buffer;
    this.noiseSource.loop = true;

    // Filter to simulate paper friction (Bandpass)
    this.filterNode = this.ctx.createBiquadFilter();
    this.filterNode.type = 'bandpass';
    this.filterNode.frequency.value = 400; // Center freq
    this.filterNode.Q.value = 0.5;

    // Gain for volume/envelope
    this.gainNode = this.ctx.createGain();
    this.gainNode.gain.value = 0;

    // Connect graph
    // Source -> Filter -> Gain -> Destination (Speakers + Stream)
    this.noiseSource.connect(this.filterNode);
    this.filterNode.connect(this.gainNode);
    
    this.gainNode.connect(this.ctx.destination);
    if (this.destination) {
      this.gainNode.connect(this.destination);
    }

    this.noiseSource.start();
    this.isPlaying = true;
  }

  public start() {
    if (!this.ctx) return;
    if (!this.isPlaying) {
      this.initAudioGraph();
    }
  }

  public stop() {
    if (this.noiseSource) {
      this.noiseSource.stop();
      this.noiseSource.disconnect();
      this.noiseSource = null;
    }
    this.isPlaying = false;
  }

  public setIntensity(velocity: number) {
    if (!this.gainNode || !this.ctx) return;
    
    // Map velocity (roughly 0-5) to volume (0-0.3)
    // Clamp velocity to avoid blowing ears
    const targetVol = Math.min(0.2, Math.max(0, velocity * 0.05));
    
    // Smooth transition
    this.gainNode.gain.setTargetAtTime(targetVol, this.ctx.currentTime, 0.05);
    
    // Modulate pitch slightly with speed for realism
    if (this.filterNode) {
       const targetFreq = 300 + (velocity * 100);
       this.filterNode.frequency.setTargetAtTime(targetFreq, this.ctx.currentTime, 0.1);
    }
  }

  public silence() {
    if (this.gainNode && this.ctx) {
      this.gainNode.gain.setTargetAtTime(0, this.ctx.currentTime, 0.05);
    }
  }
}