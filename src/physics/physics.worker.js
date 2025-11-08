const ENABLE_VERBOSE_LOGS = false;
if (ENABLE_VERBOSE_LOGS) {
    console.log('[physics.worker] initializing nebula physics worker');
}

// Core simulation config
const STRIDE = 6; // x,y,z,vx,vy,vz
const BASE_G = 6.674e-3;         // match existing G
const BASE_BH_MASS = 5e6;        // legacy baseline
const MIN_BH_MASS = 1e5;
const MAX_BH_MASS = 1e8;
const R_SOFT = 300;
const R_EVENT_HORIZON_BASE = 500;
const R_STABLE_INNER_BASE = 900;
const R_STABLE_OUTER = 8000;
const MAX_SPEED = 1200;
const DAMPING = 0.999;
const BASE_PARTICLE_MASS = 1.0;
const MAX_DT = 1 / 30; // clamp for stability

// Modes:
// - simple: BH-only orbital motion
// - complex: BH + soft neighbor influence
// - extreme: stronger neighbor influence + mild turbulence
let physicsQuality = 'simple';

// State
let maxParticles = 0;
let currentParticleCount = 0;

let dataView = null;        // Float32Array view over shared buffer
let masses = null;          // per-particle masses
let accelerations = null;   // per-particle accelerations (x,y,z)
let lastStepTime = 0;
let consumedParticles = 0;

// Black hole mass state
let bhMass = BASE_BH_MASS;

function clampBhMass(m) {
    if (!Number.isFinite(m) || m <= 0) return BASE_BH_MASS;
    if (m < MIN_BH_MASS) return MIN_BH_MASS;
    if (m > MAX_BH_MASS) return MAX_BH_MASS;
    return m;
}

function bhScale() {
    return bhMass / BASE_BH_MASS;
}

function getEventHorizonRadius() {
    return R_EVENT_HORIZON_BASE * Math.cbrt(bhMass / BASE_BH_MASS);
}

// Utility
function isActive(index6) {
    const x = dataView[index6];
    return Number.isFinite(x) && x < 99998;
}

function markConsumed(index6) {
    dataView[index6] = 99999;
    dataView[index6 + 1] = 0;
    dataView[index6 + 2] = 0;
    dataView[index6 + 3] = 0;
    dataView[index6 + 4] = 0;
    dataView[index6 + 5] = 0;
    consumedParticles++;
}

// Initialize a nebula-like disk distribution
function seedParticles(count) {
    const total = Math.max(2, Math.min(count, maxParticles));

    for (let i = 0; i < total; i++) {
        const i6 = i * STRIDE;

        // Radial distribution:
        // Blend inner disk, outer body, and extended halo with strong randomness.
        const band = Math.random();
        let radius;
        if (band < 0.25) {
            radius = 400 + Math.random() * 1800;      // bright inner/core
        } else if (band < 0.7) {
            radius = 1600 + Math.random() * 4800;     // main body
        } else {
            radius = 800 + Math.random() * 12000;     // extended halo
        }

        const angle = Math.random() * Math.PI * 2;

        // Vertical structure:
        // Higher chance of off-plane placement to avoid a flat disc.
        const verticalRoll = Math.random();
        let y;
        if (verticalRoll < 0.2) {
            // Very thin inner-disc population
            y = (Math.random() - 0.5) * 80;
        } else if (verticalRoll < 0.55) {
            // Thick/puffed torus
            const base = 150 + Math.random() * 600;
            y = (Math.random() - 0.5) * base;
        } else {
            // Halo / polar / stray particles
            const sign = Math.random() > 0.5 ? 1 : -1;
            const base = 400 + Math.random() * 3200;
            y = sign * base;
        }

        const x = Math.cos(angle) * radius;
        const z = Math.sin(angle) * radius;

        dataView[i6] = x;
        dataView[i6 + 1] = y;
        dataView[i6 + 2] = z;

        // Velocity:
        // Start with orbital around BH then inject randomness so patterns break up.
        const effectiveMass = bhMass;
        const vScale = Math.sqrt((BASE_G * effectiveMass) / Math.max(radius, R_SOFT * 2));
        const jitter = 0.5;

        let vx = -Math.sin(angle) * vScale;
        let vz = Math.cos(angle) * vScale;
        let vy = 0;

        // Stronger randomization to kill "perfect ring" feel
        vx *= 1 + (Math.random() - 0.5) * jitter;
        vz *= 1 + (Math.random() - 0.5) * jitter;
        vy = (Math.random() - 0.5) * vScale * 0.4;

        // Off-plane / polar particles get biased vertical motion so they roam in 3D
        if (Math.abs(y) > 500) {
            const upSign = y > 0 ? 1 : -1;
            vy += upSign * vScale * 0.12;
        }

        dataView[i6 + 3] = vx;
        dataView[i6 + 4] = vy;
        dataView[i6 + 5] = vz;

        masses[i] = BASE_PARTICLE_MASS;
    }

    // Mark remaining as inactive
    for (let i = total; i < maxParticles; i++) {
        const i6 = i * STRIDE;
        dataView[i6] = 99999;
        dataView[i6 + 1] = 0;
        dataView[i6 + 2] = 0;
        dataView[i6 + 3] = 0;
        dataView[i6 + 4] = 0;
        dataView[i6 + 5] = 0;
        masses[i] = 0;
    }

    currentParticleCount = total;
}

 // Resets active particle set to desired count while preserving disk look.
 // IMPORTANT:
 // - Allows lowering particle counts all the way to 0.
 // - When clamped == 0 we mark all particles inactive so the main thread
 //   (via particleCount=0 in messages) can safely clear instances.
function resetParticles(targetCount) {
    const clamped = Math.max(0, Math.min(targetCount, maxParticles));
    consumedParticles = 0;

    if (clamped === 0) {
        // Fully deactivate all particles
        for (let i = 0; i < maxParticles; i++) {
            const i6 = i * STRIDE;
            dataView[i6] = 99999;
            dataView[i6 + 1] = 0;
            dataView[i6 + 2] = 0;
            dataView[i6 + 3] = 0;
            dataView[i6 + 4] = 0;
            dataView[i6 + 5] = 0;
            masses[i] = 0;
        }
        currentParticleCount = 0;
        return;
    }

    seedParticles(clamped);
}

// Respawn a particle into stable outer bands around the BH (closer to feed inner disk)
function respawnParticle(i6) {
    // Choose outer band with slightly nearer radii so material can flow inward
    const band = Math.random();
    let radius;
    if (band < 0.4) {
        // Inner outer-disk
        radius = 5000 + Math.random() * 3000;   // 5k–8k
    } else if (band < 0.8) {
        // Mid outer-disk
        radius = 8000 + Math.random() * 4000;   // 8k–12k
    } else {
        // Farther halo, still not absurdly distant
        radius = 11000 + Math.random() * 5000;  // 11k–16k
    }

    const angle = Math.random() * Math.PI * 2;

    // Vertical distribution
    const verticalRoll = Math.random();
    let y;
    if (verticalRoll < 0.4) {
        y = (Math.random() - 0.5) * 400;
    } else {
        const sign = Math.random() > 0.5 ? 1 : -1;
        y = sign * (600 + Math.random() * 2600);
    }

    const x = Math.cos(angle) * radius;
    const z = Math.sin(angle) * radius;

    const effectiveMass = bhMass;
    const vOrb = Math.sqrt((BASE_G * effectiveMass) / Math.max(radius, R_SOFT * 2));

    // Tangential base
    let vx = -Math.sin(angle) * vOrb;
    let vz =  Math.cos(angle) * vOrb;

    // Mild inward bias (slightly stronger to encourage gradual infall)
    const inward = 0.22;
    vx += (-x / radius) * vOrb * 0.5 * inward;
    vz += (-z / radius) * vOrb * 0.5 * inward;

    let vy = (Math.random() - 0.5) * vOrb * 0.2;

    // Small jitter
    const jitter = 0.35;
    vx *= 1 + (Math.random() - 0.5) * jitter;
    vz *= 1 + (Math.random() - 0.5) * jitter;

    // Clamp speed
    let speed2 = vx * vx + vy * vy + vz * vz;
    if (speed2 > MAX_SPEED * MAX_SPEED) {
        const s = MAX_SPEED / Math.sqrt(speed2);
        vx *= s; vy *= s; vz *= s;
    }

    dataView[i6]     = x;
    dataView[i6 + 1] = y;
    dataView[i6 + 2] = z;
    dataView[i6 + 3] = vx;
    dataView[i6 + 4] = vy;
    dataView[i6 + 5] = vz;
    masses[i6 / STRIDE] = BASE_PARTICLE_MASS;
}

function consumeAndRespawn(i6) {
    consumedParticles++;
    respawnParticle(i6);
}

 
 function getAccretionBias() {
     const s = bhScale();
     // Gently boosts inner radial relaxation with BH mass, capped to avoid instability
     return 1.0 + 1.5 * Math.min(3.0, Math.sqrt(s));
 }
 
 // Simple BH-centric force field (bhMass-aware with consume/respawn)
 function integrateSimple(dt) {
     const scale = bhScale();
 
     // Swirl: clear rotation, but sublinear growth and capped so gravity dominates at high mass
     let swirlStrength = 0.4 * Math.sqrt(scale);
     if (swirlStrength > 0.9) swirlStrength = 0.9;
 
     // Radial relax: grows faster with mass than swirl to encourage inner tightening/infall
     const baseRadialRelax = 0.02;
     let effectiveRadialRelax = baseRadialRelax * (0.8 + 1.2 * Math.sqrt(scale));
 
     const rH = getEventHorizonRadius();
     const rH2 = rH * rH;
 
     for (let i = 0; i < currentParticleCount; i++) {
         const i6 = i * STRIDE;
         if (!isActive(i6)) continue;
 
         let x = dataView[i6];
         let y = dataView[i6 + 1];
         let z = dataView[i6 + 2];
 
         const rXY = Math.sqrt(x * x + z * z) || 1.0;
 
         // Tangential swirl direction around BH in disk plane
         const tx = -z / rXY;
         const tz =  x / rXY;
 
         // Vector from particle toward BH (with mild vertical suppression)
         const dx = -x;
         const dy = -y * 0.3;
         const dz = -z;
 
         const r2 = dx * dx + dy * dy + dz * dz;
         const safeR2 = Math.max(r2, R_SOFT * R_SOFT);
         const invDist = 1 / Math.sqrt(safeR2);
 
         // BH grav term ~ G * M / r^2, using safeR2
         const grav = (BASE_G * bhMass) / safeR2;
 
         // If inside inner stable band, enhance inward pull with accretion bias
         const r = Math.sqrt(r2);
         let localRadialRelax = effectiveRadialRelax;
         if (r < R_STABLE_INNER_BASE * 2.0) {
             localRadialRelax *= getAccretionBias();
         }
 
         // Tangential + radial BH terms:
         // - swirlStrength controls orbital speed
         // - localRadialRelax scales inward pull so high mass tightens/accelerates orbits
         let ax = tx * swirlStrength + dx * invDist * grav * localRadialRelax;
         let ay = dy * invDist * grav * localRadialRelax * 0.4;
         let az = tz * swirlStrength + dz * invDist * grav * localRadialRelax;
 
         // Tiny jitter to avoid perfectly frozen configurations
         ax += (Math.random() - 0.5) * 0.02;
         ay += (Math.random() - 0.5) * 0.01;
         az += (Math.random() - 0.5) * 0.02;
 
         const vxIndex = i6 + 3;
         let vx = dataView[vxIndex];
         let vy = dataView[vxIndex + 1];
         let vz = dataView[vxIndex + 2];
 
         vx += ax * dt;
         vy += ay * dt;
         vz += az * dt;
 
         // Damping
         vx *= DAMPING;
         vy *= DAMPING;
         vz *= DAMPING;
 
         // Clamp speed
         let speed2 = vx * vx + vy * vy + vz * vz;
         if (speed2 > MAX_SPEED * MAX_SPEED) {
             const s = MAX_SPEED / Math.sqrt(speed2);
             vx *= s; vy *= s; vz *= s;
         }
 
         // Integrate position
         const nx = x + vx * dt;
         const ny = y + vy * dt;
         const nz = z + vz * dt;
 
         // Event horizon consume & respawn (uses same horizon function; more hits at high mass)
         const newR2 = nx * nx + ny * ny + nz * nz;
         if (newR2 < rH2) {
             consumeAndRespawn(i6);
             continue;
         }
 
         dataView[vxIndex] = vx;
         dataView[vxIndex + 1] = vy;
         dataView[vxIndex + 2] = vz;
 
         dataView[i6]     = nx;
         dataView[i6 + 1] = ny;
         dataView[i6 + 2] = nz;
     }
 }
 // Bounded neighbor interaction for complex/extreme
function integrateNeighborField(dt, intensity, turbulence) {
    const total = currentParticleCount;
    if (total <= 2) return;

    // Choose a stride so each particle samples O(64-128) neighbors max
    const targetSamples = 72;
    const step = Math.max(1, Math.floor(total / targetSamples));

    // Precompute BH-scale dependent factors (no per-particle allocations)
    const scale = bhScale();

    // Slightly stronger radial coupling than before; scales with sqrt(scale)
    const baseRadialRelax = 0.018;
    const effectiveRadialRelax = baseRadialRelax * (0.8 + 1.3 * Math.sqrt(scale));

    // Swirl for complex/extreme: milder and capped so BH gravity dominates at high mass
    let swirlStrength = 0.18 * Math.sqrt(scale);
    if (swirlStrength > 0.6) swirlStrength = 0.6;

    for (let i = 0; i < total; i++) {
        const i6 = i * STRIDE;
        if (!isActive(i6)) continue;

        const x = dataView[i6];
        const y = dataView[i6 + 1];
        const z = dataView[i6 + 2];

        let ax = 0;
        let ay = 0;
        let az = 0;

        // Central BH pull (bhMass-aware) with softening + radialRelax modulation
        {
            const dx = -x;
            const dy = -y;
            const dz = -z;
            const distSq = dx * dx + dy * dy + dz * dz;
            const minR2 = R_SOFT * R_SOFT;
            const safeDistSq = Math.max(distSq, minR2);
            const invDist = 1 / Math.sqrt(safeDistSq);
            const forceMag = (BASE_G * bhMass) * invDist * invDist;

            ax += dx * invDist * forceMag * effectiveRadialRelax;
            ay += dy * invDist * forceMag * effectiveRadialRelax * 0.25;
            az += dz * invDist * forceMag * effectiveRadialRelax;
        }

        // Add mild tangential swirl around BH within stable orbital band
        {
            const rXY = Math.sqrt(x * x + z * z) || 1.0;
            const r = Math.sqrt(x * x + y * y + z * z);

            if (r > R_SOFT && r < R_STABLE_OUTER) {
                const tx = -z / rXY;
                const tz =  x / rXY;

                // Falloff so swirl is strongest in inner/mid disk, very mild outward
                const inner = R_SOFT * 2.0;
                const outer = R_STABLE_OUTER;
                const t = Math.min(1, Math.max(0, (r - inner) / (outer - inner)));
                const swirlFalloff = 1.0 - 0.4 * t;

                ax += tx * swirlStrength * swirlFalloff;
                az += tz * swirlStrength * swirlFalloff;
            }
        }

        // Sample neighbors sparsely for local structure and subtle breathing motion
        for (let j = 0; j < total; j += step) {
            if (j === i) continue;
            const j6 = j * STRIDE;
            if (!isActive(j6)) continue;

            const nx = dataView[j6];
            const ny = dataView[j6 + 1];
            const nz = dataView[j6 + 2];

            const dx = nx - x;
            const dy = ny - y;
            const dz = nz - z;
            const distSq = dx * dx + dy * dy + dz * dz;
            if (distSq < 200 || distSq > 8000 * 8000) continue;

            const invDist = 1 / Math.sqrt(distSq);
            const falloff = intensity * invDist * invDist;

            // Attractive / repulsive mix for filamentary look
            ax += dx * invDist * falloff * 0.5;
            ay += dy * invDist * falloff * 0.25;
            az += dz * invDist * falloff * 0.5;
        }

        // Optional turbulence for extreme mode (very subtle, avoids noise)
        if (turbulence > 0) {
            const noise = (seed) => {
                const s = Math.sin(seed * 12.9898) * 43758.5453;
                return (s - Math.floor(s)) * 2 - 1;
            };
            const n = turbulence * 0.5;
            ax += noise(x * 0.13 + y * 0.27 + z * 0.19) * n;
            ay += noise(x * 0.31 - z * 0.17) * n * 0.3;
            az += noise(y * 0.41 + x * 0.07) * n;
        }

        const vxIndex = i6 + 3;
        let vx = dataView[vxIndex];
        let vy = dataView[vxIndex + 1];
        let vz = dataView[vxIndex + 2];

        vx += ax * dt;
        vy += ay * dt;
        vz += az * dt;

        // Damping for stability
        vx *= DAMPING;
        vy *= DAMPING;
        vz *= DAMPING;

        // Clamp speed
        let speed2 = vx * vx + vy * vy + vz * vz;
        if (speed2 > MAX_SPEED * MAX_SPEED) {
            const s = MAX_SPEED / Math.sqrt(speed2);
            vx *= s; vy *= s; vz *= s;
        }

        // Integrate
        const nx2 = x + vx * dt;
        const ny2 = y + vy * dt;
        const nz2 = z + vz * dt;

        // Event horizon consume & respawn
        const rH = getEventHorizonRadius();
        const rH2 = rH * rH;
        const newR2 = nx2 * nx2 + ny2 * ny2 + nz2 * nz2;
        if (newR2 < rH2) {
            consumeAndRespawn(i6);
            continue;
        }

        dataView[vxIndex] = vx;
        dataView[vxIndex + 1] = vy;
        dataView[vxIndex + 2] = vz;

        dataView[i6] = nx2;
        dataView[i6 + 1] = ny2;
        dataView[i6 + 2] = nz2;
    }
}

self.onmessage = (e) => {
    const { type, ...data } = e.data;

    if (type === 'init') {
        maxParticles = data.maxParticles || 500000;

        const buffer = new ArrayBuffer(maxParticles * STRIDE * Float32Array.BYTES_PER_ELEMENT);
        dataView = new Float32Array(buffer);
        masses = new Float32Array(maxParticles);
        accelerations = new Float32Array(maxParticles * 3);

        resetParticles(10000);
        lastStepTime = performance.now();

        self.postMessage({ type: 'initialized', buffer }, [buffer]);
        return;
    }

    if (!dataView) {
        // Not initialized; ignore.
        return;
    }

    if (!e.data.buffer) {
        // Non-buffer control messages are not used in this simplified worker.
        return;
    }

    // Adopt buffer from main
    dataView = new Float32Array(e.data.buffer);

    // Handle incoming state changes
    let needsReset = false;
    let stateChanged = false;

    if (Object.prototype.hasOwnProperty.call(data, 'particleCount')) {
        const target = parseInt(data.particleCount, 10);
        if (Number.isFinite(target)) {
            resetParticles(target);
            needsReset = true;
            stateChanged = true;
        }
    }

    if (Object.prototype.hasOwnProperty.call(data, 'quality')) {
        const q = String(data.quality);
        if (q === 'simple' || q === 'complex' || q === 'extreme') {
            physicsQuality = q;
            stateChanged = true;
        }
    }

    if (Object.prototype.hasOwnProperty.call(data, 'bhMass')) {
        bhMass = clampBhMass(data.bhMass);
        // no state_updated; bhMass smoothly affects forces
    }

    if (needsReset) {
        // After a reset we acknowledge immediately; the next physics_update
        // will carry the first fully coherent frame for the new particle set.
        self.postMessage({ type: 'state_updated' });
    } else if (stateChanged) {
        // Pure quality / param tweaks: confirm state is applied.
        self.postMessage({ type: 'state_updated' });
    }

    // Physics step
    const now = performance.now();
    let dt = (now - lastStepTime) / 1000;
    lastStepTime = now;
    if (!Number.isFinite(dt) || dt <= 0) dt = 1 / 60;
    if (dt > MAX_DT) dt = MAX_DT;

    consumedParticles = 0;

    if (currentParticleCount > 0) {
        switch (physicsQuality) {
            case 'simple':
                integrateSimple(dt);
                break;
            case 'complex':
                integrateNeighborField(dt, 0.5, 0.0);
                break;
            case 'extreme':
                integrateNeighborField(dt, 0.9, 0.15);
                break;
            default:
                integrateSimple(dt);
        }
    }

    self.postMessage({
        type: 'physics_update',
        buffer: dataView.buffer,
        particleCount: currentParticleCount,
        consumedParticles
    }, [dataView.buffer]);
};