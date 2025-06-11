console.log(`[physics.worker] Script loaded and executing.`);

let dataView, accelerations, masses;
let maxParticles = 0, currentParticleCount = 0;
const STRIDE = 6;
let G = 6.674;
let blackHoleMass = 400000;
let physicsQuality = 'simple';
let consumedParticles = 0;
const MOON_MASS = 50000;
const PARTICLE_RADIUS_SQ = 25;

function updateSimple(dt) {
    for (let i = 2; i < currentParticleCount; i++) {
        const i3 = i * 3, i6 = i * STRIDE;
        const p1_x = dataView[i6];
        if (p1_x > 99998) continue;
        const p1_y = dataView[i6 + 1], p1_z = dataView[i6 + 2];
        
        const dx_bh = -p1_x, dy_bh = -p1_y, dz_bh = -p1_z;
        const distSq_bh = dx_bh * dx_bh + dy_bh * dy_bh + dz_bh * dz_bh;
        if (distSq_bh < 10000) { dataView[i6] = 99999; consumedParticles++; continue; }
        const forceMag_bh = G * blackHoleMass / distSq_bh;
        const invDist_bh = 1 / Math.sqrt(distSq_bh);
        let acc_x = dx_bh * invDist_bh * forceMag_bh;
        let acc_y = dy_bh * invDist_bh * forceMag_bh;
        let acc_z = dz_bh * invDist_bh * forceMag_bh;

        const moon_x = dataView[STRIDE], moon_y = dataView[STRIDE+1], moon_z = dataView[STRIDE+2];
        const dx_m = moon_x - p1_x, dy_m = moon_y - p1_y, dz_m = moon_z - p1_z;
        const distSq_m = dx_m * dx_m + dy_m * dy_m + dz_m * dz_m;
        if (distSq_m > 100) {
            const forceMag_m = G * MOON_MASS / distSq_m;
            const invDist_m = 1 / Math.sqrt(distSq_m);
            acc_x += dx_m * invDist_m * forceMag_m;
            acc_y += dy_m * invDist_m * forceMag_m;
            acc_z += dz_m * invDist_m * forceMag_m;
        }

        accelerations[i3] = acc_x;
        accelerations[i3 + 1] = acc_y;
        accelerations[i3 + 2] = acc_z;
    }
}

function updateNBody(dt, withCollisions) {
    for (let i = 2; i < currentParticleCount; i++) {
        const i3 = i * 3, i6 = i * STRIDE;
        let acc_x = 0, acc_y = 0, acc_z = 0;
        const p1_x = dataView[i6];
        if (p1_x > 99998) continue;
        const p1_y = dataView[i6 + 1], p1_z = dataView[i6 + 2];
        
        for (let j = 0; j < currentParticleCount; j++) {
            if (i === j) continue;
            const p2_x = dataView[j * STRIDE];
            if (p2_x > 99998) continue;
            const p2_y = dataView[j * STRIDE + 1], p2_z = dataView[j * STRIDE + 2];
            const dx = p2_x - p1_x, dy = p2_y - p1_y, dz = p2_z - p1_z;
            let distSq = dx * dx + dy * dy + dz * dz;

            if (withCollisions && i > 1 && j > 1 && distSq < PARTICLE_RADIUS_SQ) {
                 dataView[j * STRIDE] = 99999;
                 consumedParticles++;
                 continue;
            }

            if (distSq < 400) { if(j === 0) { dataView[i6] = 99999; consumedParticles++; } continue; }
            const forceMag = G * masses[j] / distSq;
            const invDist = 1 / Math.sqrt(distSq);
            acc_x += dx * invDist * forceMag;
            acc_y += dy * invDist * forceMag;
            acc_z += dz * invDist * forceMag;
        }
        accelerations[i3] = acc_x;
        accelerations[i3 + 1] = acc_y;
        accelerations[i3 + 2] = acc_z;
    }
}

function applyForces(dt) {
     for (let i = 2; i < currentParticleCount; i++) {
        const i6 = i * STRIDE, i3 = i * 3;
        if (dataView[i6] > 99998) continue;
        dataView[i6 + 3] += accelerations[i3] * dt;
        dataView[i6 + 4] += accelerations[i3 + 1] * dt;
        dataView[i6 + 5] += accelerations[i3 + 2] * dt;
        dataView[i6] += dataView[i6 + 3] * dt;
        dataView[i6 + 1] += dataView[i6 + 4] * dt;
        dataView[i6 + 2] += dataView[i6 + 5] * dt;
    }
}

let physicsInterval;
function startPhysicsLoop() {
    console.log('[physics.worker] startPhysicsLoop() called.');
    if (physicsInterval) clearInterval(physicsInterval);
    physicsInterval = setInterval(() => {
        try {
            const physicsStartTime = performance.now();
            if (currentParticleCount > 2) {
                const dt = 1/60;
                if (physicsQuality === 'simple') {
                    updateSimple(dt);
                } else {
                    updateNBody(dt, physicsQuality === 'extreme');
                }
                applyForces(dt);
            }
            const physicsStepTime = performance.now() - physicsStartTime;
            self.postMessage({ 
                type: 'physics_update', 
                physicsStepTime, 
                consumedParticles,
                data: dataView.buffer
            });
        } catch (error) {
            self.postMessage({
                type: 'worker_error',
                error: {
                    message: error.message,
                    stack: error.stack,
                }
            });
            clearInterval(physicsInterval); // Stop the loop on error
        }
    }, 1000 / 60);
}

self.onmessage = (e) => {
    const { type, ...data } = e.data;
    console.log(`[physics.worker] onmessage received: ${type}`);

    if (type === 'init') {
        console.log('[physics.worker] Initializing...');
        maxParticles = data.maxParticles; 
        blackHoleMass = data.blackHoleMass;
        const buffer = new ArrayBuffer(maxParticles * STRIDE * Float32Array.BYTES_PER_ELEMENT);
        dataView = new Float32Array(buffer); 
        accelerations = new Float32Array(maxParticles * 3); 
        masses = new Float32Array(maxParticles);
        masses[0] = blackHoleMass;
        masses[1] = MOON_MASS;
        currentParticleCount = 2;
        console.log('[physics.worker] Initialization complete. Starting physics loop.');
        self.postMessage({ type: 'initialized', buffer: dataView.buffer });
        startPhysicsLoop();
    } else if (type === 'set_particles') {
        const newParticleCount = Math.min(maxParticles - 2, data.count);
        const oldTotalCount = currentParticleCount;
        currentParticleCount = newParticleCount + 2;

        if (currentParticleCount > oldTotalCount) {
            for (let i = oldTotalCount; i < currentParticleCount; i++) {
                const i6 = i * STRIDE;
                const radius = 2000 + Math.random() * 8000;
                const theta = 2 * Math.PI * Math.random(); 
                const phi = Math.acos(2 * Math.random() - 1) - Math.PI / 2;
                const x = radius * Math.cos(theta) * Math.cos(phi);
                const y = radius * Math.sin(phi) * 0.5;
                const z = radius * Math.sin(theta) * Math.cos(phi);
                dataView[i6] = x; dataView[i6 + 1] = y; dataView[i6 + 2] = z;
                
                const velMag = Math.sqrt(G * blackHoleMass / radius) * (0.8 + Math.random() * 0.2);
                const tangent = new Float32Array([-z, 0, x]);
                const mag = Math.sqrt(tangent[0]*tangent[0] + tangent[2]*tangent[2]);
                if (mag > 1e-9) { tangent[0] /= mag; tangent[2] /= mag; }
                dataView[i6 + 3] = tangent[0] * velMag;
                dataView[i6 + 4] = (Math.random() - 0.5) * 20;
                dataView[i6 + 5] = tangent[2] * velMag;
                masses[i] = 1 + Math.random() * 5;
            }
        }
    } else if (type === 'set_mass') {
        blackHoleMass = data.mass; if(masses) masses[0] = blackHoleMass;
    } else if (type === 'set_quality') {
        physicsQuality = data.quality;
    } else if (type === 'reset') {
        currentParticleCount = 2; consumedParticles = 0;
    } else if (type === 'update_moon') {
        if (!dataView) return;
        dataView[STRIDE] = data.x;
        dataView[STRIDE+1] = data.y;
        dataView[STRIDE+2] = data.z;
    }
};