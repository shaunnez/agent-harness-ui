import type { WorldPreferences } from "./preferences";

/** Quiet local ambience and selection feedback; never signals simulated execution. */
export class WorldAudio {
  private context: AudioContext | null = null;
  private ambient: GainNode | null = null;
  private source: AudioBufferSourceNode | null = null;
  private effects = false;
  async configure(preferences: WorldPreferences) {
    this.effects = preferences.effectsAudio;
    if (!preferences.ambientAudio && !preferences.effectsAudio && !this.context) return;
    this.context ??= new AudioContext();
    if (preferences.ambientAudio || preferences.effectsAudio) await this.context.resume();
    if (!this.ambient) {
      const buffer = this.context.createBuffer(1, this.context.sampleRate * 4, this.context.sampleRate);
      const data = buffer.getChannelData(0);
      let seed = 37;
      for (let i = 0; i < data.length; i++) {
        seed = (seed * 16807) % 2147483647;
        data[i] = (seed / 2147483647) * 2 - 1;
      }
      this.source = this.context.createBufferSource();
      this.source.buffer = buffer;
      this.source.loop = true;
      const filter = this.context.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.value = 350;
      this.ambient = this.context.createGain();
      this.ambient.gain.value = 0;
      this.source.connect(filter).connect(this.ambient).connect(this.context.destination);
      this.source.start();
    }
    this.ambient.gain.setTargetAtTime(preferences.ambientAudio ? 0.09 : 0, this.context.currentTime, 0.3);
  }
  select() {
    if (!this.effects || !this.context || this.context.state !== "running") return;
    const at = this.context.currentTime,
      oscillator = this.context.createOscillator(),
      gain = this.context.createGain();
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(620, at);
    oscillator.frequency.exponentialRampToValueAtTime(400, at + 0.1);
    gain.gain.setValueAtTime(0.035, at);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.12);
    oscillator.connect(gain).connect(this.context.destination);
    oscillator.start(at);
    oscillator.stop(at + 0.13);
    oscillator.onended = () => {
      oscillator.disconnect();
      gain.disconnect();
    };
  }
  destroy() {
    this.source?.stop();
    void this.context?.close();
  }
}
