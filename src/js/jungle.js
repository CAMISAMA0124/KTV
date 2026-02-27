// jungle.js
// A Web Audio API Pitch Shifter. Based on Chris Wilson's Jungle Pitch Shifter algorithm.

function createFadeBuffer(context, activeTime, fadeTime) {
    var length1 = activeTime * context.sampleRate;
    var length2 = (activeTime - 2 * fadeTime) * context.sampleRate;
    var length = length1 + length2;
    var buffer = context.createBuffer(1, length, context.sampleRate);
    var p = buffer.getChannelData(0);

    var fadeLength = fadeTime * context.sampleRate;
    var fadeIndex1 = fadeLength;
    var fadeIndex2 = length1 - fadeLength;

    for (var i = 0; i < length1; ++i) {
        var value;
        if (i < fadeIndex1) {
            value = Math.sqrt(i / fadeLength);
        } else if (i >= fadeIndex2) {
            value = Math.sqrt(1 - (i - fadeIndex2) / fadeLength);
        } else {
            value = 1;
        }
        p[i] = value;
    }

    for (var i = length1; i < length; ++i) {
        p[i] = 0;
    }

    return buffer;
}

function createDelayTimeBuffer(context, activeTime, fadeTime, shiftUp) {
    var length1 = activeTime * context.sampleRate;
    var length2 = (activeTime - 2 * fadeTime) * context.sampleRate;
    var length = length1 + length2;
    var buffer = context.createBuffer(1, length, context.sampleRate);
    var p = buffer.getChannelData(0);

    for (var i = 0; i < length1; ++i) {
        if (shiftUp) {
            // This line does shift-up transpose
            p[i] = (length1 - i) / length;
        } else {
            // This line does shift-down transpose
            p[i] = i / length1;
        }
    }

    for (var i = length1; i < length; ++i) {
        p[i] = 0;
    }

    return buffer;
}

export class Jungle {
    constructor(context) {
        this.context = context;
        this.input = context.createGain();
        this.output = context.createGain();

        // Constants
        var delayTime = 0.100;
        var fadeTime = 0.050;
        var bufferTime = 0.100;

        // Create Nodes
        this.delay1 = context.createDelay(delayTime * 2);
        this.delay2 = context.createDelay(delayTime * 2);
        this.fade1 = context.createGain();
        this.fade2 = context.createGain();
        this.mod1 = context.createBufferSource();
        this.mod2 = context.createBufferSource();
        this.mod3 = context.createBufferSource(); // fade1 modulation
        this.mod4 = context.createBufferSource(); // fade2 modulation

        this.shiftDownBuffer = createDelayTimeBuffer(context, bufferTime, fadeTime, false);
        this.shiftUpBuffer = createDelayTimeBuffer(context, bufferTime, fadeTime, true);
        this.fadeBuffer = createFadeBuffer(context, bufferTime, fadeTime);

        this.mod1.buffer = this.shiftDownBuffer;
        this.mod2.buffer = this.shiftDownBuffer;
        this.mod3.buffer = this.fadeBuffer;
        this.mod4.buffer = this.fadeBuffer;

        this.mod1.loop = true;
        this.mod2.loop = true;
        this.mod3.loop = true;
        this.mod4.loop = true;

        this.mix1 = context.createGain();
        this.mix2 = context.createGain();
        this.mix1.gain.value = 0;
        this.mix2.gain.value = 0;

        // Routing
        this.input.connect(this.delay1);
        this.input.connect(this.delay2);
        this.delay1.connect(this.fade1);
        this.delay2.connect(this.fade2);
        this.fade1.connect(this.output);
        this.fade2.connect(this.output);

        // Routing modulators
        this.mod1.connect(this.delay1.delayTime);
        this.mod2.connect(this.delay2.delayTime);
        this.mod3.connect(this.fade1.gain);
        this.mod4.connect(this.fade2.gain);

        // Initialize playback
        var t = context.currentTime + 0.050; // little buffer
        this.mod1.start(t);
        this.mod2.start(t + bufferTime - fadeTime);
        this.mod3.start(t);
        this.mod4.start(t + bufferTime - fadeTime);

        // By default, no shift
        this.setPitchOffset(0);
    }

    setPitchOffset(mult) {
        let isPitchUp = mult > 0;
        let p = isPitchUp ? this.shiftUpBuffer : this.shiftDownBuffer;

        // Since we created both buffers, just assign the correct one
        // and adjust the scale (multiplier)
        let absMult = Math.abs(mult);

        // Small logic to prevent clicking when not shifting
        if (absMult === 0) {
            this.mod1.buffer = p;
            this.mod2.buffer = p;
            this.mix1.gain.setTargetAtTime(0, this.context.currentTime, 0.01);
            this.mix2.gain.setTargetAtTime(0, this.context.currentTime, 0.01);
        } else {
            this.mod1.buffer = p;
            this.mod2.buffer = p;

            // Re-connect the fade gains 
            this.mix1.gain.setTargetAtTime(1, this.context.currentTime, 0.01);
            this.mix2.gain.setTargetAtTime(1, this.context.currentTime, 0.01);

            // Scale the delay time amplitude:
            // mult is between -1 (one octave down) to +1 (one octave up)
            // But wait, the gain on mod1/2 goes directly to delayTime.
            // A multiplier of 0.5 means half octave down/up.
            window.lastMult = mult;
        }

    }
}
