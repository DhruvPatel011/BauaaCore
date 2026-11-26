const bass = gain => ({ equalizer: [0, 1, 2, 3, 4].map((band, index) => ({ band, gain: gain * (1 - index / 5) })) });

const filters = {
    "8d": { rotation: { rotationHz: 0.18 } },
    bassboost: bass(0.25),
    deepbass: bass(0.55),
    karaoke: { karaoke: { level: 1, monoLevel: 1, filterBand: 220, filterWidth: 100 } },
    lofi: { lowPass: { smoothing: 18 }, timescale: { speed: 0.95, pitch: 0.97, rate: 1 } },
    nightcore: { timescale: { speed: 1.2, pitch: 1.2, rate: 1 } },
    daycore: { timescale: { speed: 0.85, pitch: 0.85, rate: 1 } },
    darthvader: { timescale: { speed: 0.95, pitch: 0.66, rate: 1 } },
    chipmunk: { timescale: { speed: 1.05, pitch: 1.45, rate: 1 } },
    slowed: { timescale: { speed: 0.8, pitch: 0.9, rate: 1 } },
    vibration: { tremolo: { frequency: 14, depth: 0.5 }, vibrato: { frequency: 12, depth: 0.35 } },
    vibrato: { vibrato: { frequency: 4, depth: 0.45 } },
    tremolo: { tremolo: { frequency: 4, depth: 0.6 } },
};

module.exports = filters;
