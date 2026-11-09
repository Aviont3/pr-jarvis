// Voice in (Web Speech recognition) and voice out (speech synthesis).
// Works best in Google Chrome. Safari also works on recent macOS.

export class Voice {
  constructor({ onInterim, onFinal, onState, onError }) {
    this.onInterim = onInterim;
    this.onFinal = onFinal;
    this.onState = onState;
    this.onError = onError;
    this.listening = false;
    this.voiceName = '';
    this.enabled = true;
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    this.supported = !!SR;
    if (SR) {
      const r = new SR();
      r.lang = 'en-US';
      r.interimResults = true;
      r.continuous = false;
      r.maxAlternatives = 1;
      r.onresult = (ev) => {
        let interim = '';
        let final = '';
        for (let i = ev.resultIndex; i < ev.results.length; i++) {
          const res = ev.results[i];
          if (res.isFinal) final += res[0].transcript;
          else interim += res[0].transcript;
        }
        if (interim) this.onInterim?.(interim);
        if (final) this.onFinal?.(final.trim());
      };
      r.onstart = () => { this.listening = true; this.onState?.('listening'); };
      r.onend = () => { this.listening = false; this.onState?.('idle'); this.onInterim?.(''); };
      r.onerror = (ev) => {
        const msg = {
          'not-allowed': 'Microphone access is blocked. Allow it in Chrome (click the 🔒 icon in the address bar).',
          'no-speech': "I didn't hear anything. Try again.",
          'audio-capture': 'No microphone was found.',
          network: 'Speech recognition needs an internet connection in Chrome.',
        }[ev.error];
        if (ev.error !== 'aborted') this.onError?.(msg || `Voice error: ${ev.error}`);
      };
      this.rec = r;
    }
    this.voices = [];
    if ('speechSynthesis' in window) {
      const load = () => { this.voices = speechSynthesis.getVoices().filter((v) => v.lang.startsWith('en')); };
      load();
      speechSynthesis.onvoiceschanged = load;
    }
  }

  toggle() {
    if (!this.supported) {
      this.onError?.('Voice input is not supported in this browser. Please use Google Chrome.');
      return;
    }
    if (this.listening) { this.rec.stop(); return; }
    this.stopSpeaking();
    try { this.rec.start(); } catch { /* already started */ }
  }

  pickVoice() {
    if (this.voiceName) {
      const v = this.voices.find((x) => x.name === this.voiceName);
      if (v) return v;
    }
    // Prefer natural-sounding built-in Mac voices.
    const prefs = ['Daniel', 'Samantha', 'Alex', 'Google UK English Male', 'Google US English', 'Karen', 'Moira'];
    for (const p of prefs) {
      const v = this.voices.find((x) => x.name.startsWith(p));
      if (v) return v;
    }
    return this.voices[0];
  }

  speak(text, force = false) {
    if ((!this.enabled && !force) || !('speechSynthesis' in window) || !text) return;
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text.replace(/[•❗]/g, ''));
    const v = this.pickVoice();
    if (v) u.voice = v;
    u.rate = 1.05;
    u.onstart = () => this.onState?.('speaking');
    u.onend = () => this.onState?.(this.listening ? 'listening' : 'idle');
    speechSynthesis.speak(u);
  }

  stopSpeaking() {
    if ('speechSynthesis' in window) speechSynthesis.cancel();
  }
}
