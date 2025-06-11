import './style.css';
import { createUI } from './components/ui.js';
import { createScene } from './components/scene.js';
import { BenchmarkController, State } from './core/benchmark.js';
import { Log } from './core/log.js';
import { detectCapabilities } from './core/profiler.js';
import * as THREE from 'three';
import { GUI } from 'lil-gui';
import packageJson from '../package.json';

// --- CONSTANTS ---
const PARTICLE_STRIDE = 6; // (x, y, z, vx, vy, vz)
const MAX_PARTICLES = 500000;
const MOON_ORBIT_RADIUS = 3000;

// --- INITIALIZATION ---
const ui = createUI();
const gui = new GUI();
const {
    scene, camera, renderer, composer, controls,
    diskMaterial, moon, nebulaMaterials,
    filmPass, jets, jetParticles
} = createScene(gui);
document.body.insertBefore(renderer.domElement, document.getElementById('ui-container'));

const clock = new THREE.Clock();
const stats = {
    fps: { value: 0, smoothing: 0.9, lastTime: 0 },
    renderTime: { value: 0, smoothing: 0.9 },
    physicsCpu: { value: 0, smoothing: 0.9 },
    particles: { value: 0 },
    consumed: { value: 0 }
};
let systemCapabilities = {};

const physicsWorker = new Worker(new URL('./physics/physics.worker.js', import.meta.url), { type: 'module' });

const benchmarkController = new BenchmarkController();
const log = new Log();
let dataView = null;
let particleInstances = null;
let animationFrameId = null;
let activeParticleCount = 0;
let instanceColorAttribute, instanceVelocityAttribute;

// --- Animation-Scoped Temp Variables ---
// These are declared outside the animation loop to avoid re-creation on every frame.
const _tempObject = new THREE.Object3D();
const _tempColor = new THREE.Color();

// --- MAIN ---
async function main() {
    ui.versionInfo.textContent = `v${packageJson.version}`;
    systemCapabilities = await detectCapabilities(renderer);
    console.log("System Capabilities:", systemCapabilities);
    
    // Create particle instances mesh
    const particleMaterial = new THREE.ShaderMaterial({
        uniforms: {
            uTime: { value: 0.0 },
        },
        vertexShader: `
            attribute vec3 instanceColor;
            attribute vec3 instanceVelocity;
            varying vec3 vColor;
            void main() {
                vColor = instanceColor;
                vec3 p = position;
                float speed = length(instanceVelocity);
                if (speed > 1.0) {
                   vec3 dir = normalize(instanceVelocity);
                   p += dir * speed * 0.01; // Motion blur
                }
                gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(p, 1.0);
            }
        `,
        fragmentShader: `
            varying vec3 vColor;
            void main() {
                gl_FragColor = vec4(vColor * 1.5, 1.0); // Boost color for bloom
            }
        `
    });
    
    const particleGeometry = new THREE.IcosahedronGeometry(5, 0);
    // Add instanced attributes
    instanceColorAttribute = new THREE.InstancedBufferAttribute(new Float32Array(MAX_PARTICLES * 3), 3);
    instanceVelocityAttribute = new THREE.InstancedBufferAttribute(new Float32Array(MAX_PARTICLES * 3), 3);
    particleGeometry.setAttribute('instanceColor', instanceColorAttribute);
    particleGeometry.setAttribute('instanceVelocity', instanceVelocityAttribute);

    particleInstances = new THREE.InstancedMesh(particleGeometry, particleMaterial, MAX_PARTICLES);
    particleInstances.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    scene.add(particleInstances);

    console.log('[main] Awaiting first message from worker...');
    physicsWorker.onmessage = (e) => {
        switch (e.data.type) {
            case 'initialized':
                if (e.data.buffer) {
                    dataView = new Float32Array(e.data.buffer);
                    if (!animationFrameId) {
                        console.log('[main] Worker initialized. Starting animation loop...');
                        animationFrameId = requestAnimationFrame(animate);
                    }
                }
                break;
            case 'physics_update':
                if (e.data.buffer) {
                    // The worker has finished its step and sent the buffer back.
                    dataView = new Float32Array(e.data.buffer);
                    // These assignments belong here, where we know these properties exist.
                    activeParticleCount = e.data.particleCount;
                    stats.consumed.value = e.data.consumedParticles;

                    // Now that the physics is done and the buffer is back, request the next frame.
                    // This prevents the DataCloneError.
                    if (animationFrameId) {
                        animationFrameId = requestAnimationFrame(animate);
                    }
                }
                break;
            case 'worker_error':
                console.error("Received error from worker:", e.data.error);
                alert(`Physics worker crashed!\n\nMessage: ${e.data.error.message}`);
                break;
            case 'benchmark_update':
                benchmarkController.handleWorkerUpdate(e.data.payload, log);
                ui.benchmarkStatusEl.textContent = benchmarkController.state;
                if (benchmarkController.state === State.SEARCHING_MAX_Q) {
                    ui.metrics.fps.textContent = e.data.payload.fps.toFixed(1);
                }
                break;
            case 'benchmark_complete':
                benchmarkController.handleCompletion(e.data.results, systemCapabilities, log);
                ui.benchmarkStatusEl.textContent = 'Benchmark Complete. Ready for next run.';
                ui.submitScoreBtn.disabled = false;
                break;
        }
    };

    // --- EVENT LISTENERS ---
    ui.submitScoreBtn.addEventListener('click', () => {
        ui.submissionModal.backdrop.classList.remove('hidden');
        ui.submissionModal.scoreSummary.textContent = `Final Score: ${benchmarkController.finalScore}`;
        ui.submissionModal.systemSummary.innerHTML = `
            <strong>CPU:</strong> ${systemCapabilities.cpuCores} Cores<br>
            <strong>GPU:</strong> ${systemCapabilities.gpuRenderer}
        `;
    });

    ui.submissionModal.cancelBtn.addEventListener('click', () => {
        ui.submissionModal.backdrop.classList.add('hidden');
    });

    ui.submissionModal.submitBtn.addEventListener('click', async () => {
        const name = prompt("Enter your name for the leaderboard:", "Anonymous");
        if (!name) return; // User cancelled

        const submissionData = {
            name: name,
            score: benchmarkController.finalScore,
            system: {
                gpu: systemCapabilities.gpuRenderer,
                cpuCores: systemCapabilities.cpuCores,
            }
        };

        try {
            const response = await fetch('http://localhost:3000/leaderboard', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(submissionData),
            });

            if (response.ok) {
                const result = await response.json();
                alert(`Score submitted successfully! Your rank is #${result.rank}.`);
            } else {
                throw new Error(`Server error: ${response.status}`);
            }
        } catch (error) {
            console.error("Failed to submit score:", error);
            alert("Failed to submit score. See console for details.");
        } finally {
            ui.submissionModal.backdrop.classList.add('hidden');
        }
    });

    ui.benchmarkBtn.addEventListener('click', () => {
        const logFunc = (message, level = 'info') => {
            const logEntry = document.createElement('div');
            logEntry.className = `log-entry log-${level}`;
            logEntry.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
            ui.logPanel.prepend(logEntry);
        };

        if (benchmarkController.state !== State.IDLE) {
            benchmarkController.cancel(logFunc);
            ui.benchmarkBtn.textContent = 'Run Benchmark';
            // Re-enable all sandbox controls
            for (const key in ui.sandboxControls) {
                ui.sandboxControls[key].disabled = false;
            }
        } else {
            const resolution = `${renderer.domElement.width}x${renderer.domElement.height}`;
            const sceneElements = { composer, accretionDisk, nebulaMaterials };
            benchmarkController.start(log, logFunc, physicsWorker, sceneElements, resolution, systemCapabilities);
            ui.benchmarkBtn.textContent = 'Cancel Benchmark';
            // Disable all sandbox controls
            for (const key in ui.sandboxControls) {
                ui.sandboxControls[key].disabled = true;
            }
        }
    });

    ui.sandboxControls.particles.addEventListener('input', (e) => {
        if (!dataView) return;
        const count = parseInt(e.target.value, 10);
        ui.sandboxControls.particleCountLabel.textContent = count.toLocaleString();
        physicsWorker.postMessage({ type: 'set_particles', count: count, buffer: dataView.buffer }, [dataView.buffer]);
    });

    ui.sandboxControls.bhMass.addEventListener('input', (e) => {
        if (!dataView) return;
        const mass = parseInt(e.target.value, 10);
        physicsWorker.postMessage({ type: 'set_mass', mass: mass, buffer: dataView.buffer }, [dataView.buffer]);
    });

    ui.sandboxControls.physicsQuality.addEventListener('change', (e) => {
        if (!dataView) return;
        physicsWorker.postMessage({ type: 'set_quality', quality: e.target.value, buffer: dataView.buffer }, [dataView.buffer]);
    });

    ui.sandboxControls.resetCameraBtn.addEventListener('click', () => {
        controls.reset();
        camera.position.set(0, 1000, 2500);
    });

    // Initialize and start the worker
    physicsWorker.postMessage({ type: 'init', maxParticles: MAX_PARTICLES, blackHoleMass: 400000 });
}

// --- ANIMATION ---
function animate() {
    animationFrameId = requestAnimationFrame(animate);

    if (!dataView) return; 

    const now = performance.now();
    const dt = clock.getDelta();
    const elapsedTime = clock.getElapsedTime();

    // Update stats
    stats.fps.value = 1000 / (now - stats.fps.lastTime);
    stats.fps.lastTime = now;
    if (ui.metrics.fps) ui.metrics.fps.textContent = stats.fps.value.toFixed(1);
    if (ui.metrics.particles) ui.metrics.particles.textContent = activeParticleCount.toLocaleString();
    if (ui.metrics.consumed) ui.metrics.consumed.textContent = stats.consumed.value.toLocaleString();

    benchmarkController.update(performance.now());
    
    diskMaterial.uniforms.uTime.value = elapsedTime;
    nebulaMaterials.forEach(m => m.uniforms.uTime.value = elapsedTime);
    if (filmPass) filmPass.uniforms.time.value = elapsedTime;

    moon.position.set(
        Math.cos(elapsedTime * 0.1) * MOON_ORBIT_RADIUS,
        0,
        Math.sin(elapsedTime * 0.1) * MOON_ORBIT_RADIUS
    );
    
    // Always send the buffer back to the worker for the next frame.
    physicsWorker.postMessage({ 
        type: 'update_moon', 
        x: moon.position.x, 
        y: moon.position.y, 
        z: moon.position.z,
        buffer: dataView.buffer
    }, [dataView.buffer]);


    updateParticles(activeParticleCount, elapsedTime);
    updateJets(dt);

    controls.update();
    composer.render(dt);
}

function updateParticles(particleCount, elapsedTime) {
    const baseHue = 0.6; // Blueish
    const hueVariance = 0.1;

    for (let i = 0; i < particleCount; i++) {
        const offset = i * PARTICLE_STRIDE;
        _tempObject.position.set(dataView[offset], dataView[offset + 1], dataView[offset + 2]);
        _tempObject.updateMatrix();
        particleInstances.setMatrixAt(i, _tempObject.matrix);

        const vx = dataView[offset + 3];
        const vy = dataView[offset + 4];
        const vz = dataView[offset + 5];
        instanceVelocityAttribute.setXYZ(i, vx, vy, vz);
        
        const speed = Math.sqrt(vx * vx + vy * vy + vz * vz);
        const hue = baseHue + (i % 20 / 20) * hueVariance;
        const saturation = Math.max(0.2, 1.0 - speed / 400);
        const lightness = Math.min(1.0, 0.4 + speed / 200.0);
        _tempColor.setHSL(hue, saturation, lightness);
        instanceColorAttribute.setXYZ(i, _tempColor.r, _tempColor.g, _tempColor.b);
    }
    particleInstances.count = particleCount;
    particleInstances.instanceMatrix.needsUpdate = true;
    instanceColorAttribute.needsUpdate = true;
    instanceVelocityAttribute.needsUpdate = true;
}

function updateJets(dt) {
    const positions = jets.geometry.attributes.position.array;
    let visibleJetParticles = 0;

    for (let i = 0; i < jetParticles.length; i++) {
        const p = jetParticles[i];
        p.lifetime -= dt;

        if (p.lifetime <= 0) {
            // Respawn particle
            p.lifetime = p.initialLifetime = 2 + Math.random() * 3;
            const y = (Math.random() > 0.5 ? 1 : -1) * 110; // Start just above/below the pole
            p.velocity.set(
                (Math.random() - 0.5) * 200,
                (y > 0 ? 1 : -1) * (1000 + Math.random() * 1000),
                (Math.random() - 0.5) * 200
            );
            positions[i * 3] = 0;
            positions[i * 3 + 1] = y;
            positions[i * 3 + 2] = 0;
        } else {
            // Update position
            const currentX = positions[i * 3];
            const currentY = positions[i * 3 + 1];
            const currentZ = positions[i * 3 + 2];

            positions[i * 3] = currentX + p.velocity.x * dt;
            positions[i * 3 + 1] = currentY + p.velocity.y * dt;
            positions[i * 3 + 2] = currentZ + p.velocity.z * dt;
        }
        visibleJetParticles++;
    }
    jets.geometry.setDrawRange(0, visibleJetParticles);
    jets.geometry.attributes.position.needsUpdate = true;
}

main().catch(console.error);

ui.leaderboardBtn.addEventListener('click', () => {
    window.location.href = 'leaderboard.html';
});