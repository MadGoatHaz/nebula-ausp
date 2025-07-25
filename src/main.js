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
const mainGui = new GUI();
const {
    scene, camera, renderer, composer, controls,
    accretionDisk, diskMaterial, moon, nebulaMaterials,
    filmPass, jets, jetParticles, gui
} = createScene(mainGui);
document.body.insertBefore(renderer.domElement, document.getElementById('ui-container'));

const clock = new THREE.Clock();
const stats = {
    fps: { value: 0, smoothing: 0.9, lastTime: 0 },
    renderTime: { value: 0, smoothing: 0.9 },
    physicsCpu: { value: 0, smoothing: 0.9, lastTime: performance.now() },
    particles: { value: 0 },
    consumed: { value: 0 }
};
let systemCapabilities = {};

// Performance Graph Data
const perfHistory = {
    cpu: new Array(100).fill(0),
    gpu: new Array(100).fill(0)
};

const physicsWorker = new Worker(new URL('./physics/physics.worker.js', import.meta.url), { type: 'module' });

const benchmarkController = new BenchmarkController();
const log = new Log();
let dataView = null;
let particleInstances = null;
let animationFrameId = null;
let activeParticleCount = 0;
let instanceColorAttribute, instanceVelocityAttribute;

// This object will hold the latest state from the UI controls.
const simState = {
    particleCount: 10000,
    bhMass: 400000,
    physicsQuality: 'simple',
};
let stateChanged = false; // Flag to indicate if we need to send updates
let resolveStateUpdate = null; // To resolve the promise after worker confirms state change

// --- Animation-Scoped Temp Variables ---
// These are declared outside the animation loop to avoid re-creation on every frame.
const _tempObject = new THREE.Object3D();
const _tempColor = new THREE.Color();

// --- MAIN ---
async function main() {
    ui.versionInfo.textContent = `v${packageJson.version}`;
    systemCapabilities = await detectCapabilities(renderer);
    console.log("System Capabilities:", systemCapabilities);
    
    // Populate System Info panel
    if (ui.systemInfo.cpu) ui.systemInfo.cpu.textContent = systemCapabilities.cpuCores;
    if (ui.systemInfo.gpu) ui.systemInfo.gpu.textContent = systemCapabilities.gpuRenderer;
    
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
        // Handle non-buffer messages separately ---------------------------
        if (!e.data.buffer) {
            switch (e.data.type) {
                case 'state_updated':
                    if (resolveStateUpdate) {
                        resolveStateUpdate();
                        resolveStateUpdate = null;
                    }
                    return;
                case 'worker_error':
                    console.error("Received error from worker:", e.data.error);
                    alert(`Physics worker crashed!\n\nMessage: ${e.data.error.message}`);
                    return;
            }
        }

        // Buffer-based messages -----------------------------------------
        dataView = new Float32Array(e.data.buffer);

        switch (e.data.type) {
            case 'initialized':
                // Worker is ready, kick off the render loop. We will send the first
                // physics_update after the first animation frame so the render loop
                // gets at least one buffer to draw.
                bufferReady = true; // Ready to send first update during first frame
                renderLoop();
                break;

            case 'physics_update':
                // Physics step finished; we now own the buffer until we hand it back.
                stats.physicsCpu.value = performance.now() - stats.physicsCpu.lastTime;
                activeParticleCount = e.data.particleCount;
                stats.consumed.value = e.data.consumedParticles;

                if (activeParticleCount === 0) {
                    activeParticleCount = simState.particleCount;
                }

                bufferReady = true; // Flag for the render loop
                break;
        }
    };

    // --- EVENT LISTENERS ---
    ui.toggleControlsBtn.addEventListener('click', () => {
        mainGui.show(mainGui._hidden);
    });

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
            
            // This is the new callback function for the benchmark controller
            const onBenchmarkStateChange = (newState) => {
                simState.physicsQuality = newState.quality;
                simState.particleCount = newState.particleCount;
                stateChanged = true;

                // Return a promise that will resolve when the worker confirms the update
                return new Promise((resolve) => {
                    resolveStateUpdate = resolve;
                });
            };

            benchmarkController.start(log, logFunc, onBenchmarkStateChange, sceneElements, resolution, systemCapabilities);
            ui.benchmarkBtn.textContent = 'Cancel Benchmark';
            // Disable all sandbox controls
            for (const key in ui.sandboxControls) {
                ui.sandboxControls[key].disabled = true;
            }
        }
    });

    ui.sandboxControls.particles.addEventListener('input', (e) => {
        simState.particleCount = parseInt(e.target.value, 10);
        ui.sandboxControls.particleCountLabel.textContent = simState.particleCount.toLocaleString();
        stateChanged = true;
    });

    ui.sandboxControls.bhMass.addEventListener('input', (e) => {
        simState.bhMass = parseInt(e.target.value, 10);
        stateChanged = true;
    });

    ui.sandboxControls.physicsQuality.addEventListener('change', (e) => {
        simState.physicsQuality = e.target.value;
        stateChanged = true;
    });

    ui.sandboxControls.resetCameraBtn.addEventListener('click', () => {
        controls.reset();
        camera.position.set(0, 1000, 2500);
    });

    // Initialize and start the worker
    physicsWorker.postMessage({ type: 'init', maxParticles: MAX_PARTICLES });
}

let bufferReady = false; // Indicates we have a buffer ready for this frame

// --- RENDER LOOP ---
function renderLoop() {
    animationFrameId = requestAnimationFrame(renderLoop);
    animate();
}

// --- ANIMATION ---
function animate() {
    // THIS FUNCTION ONLY RENDERS. NO LOGIC, NO POSTMESSAGE.
    if (!dataView) return;

    const now = performance.now();
    const dt = clock.getDelta();
    const elapsedTime = clock.getElapsedTime();

    // Update stats
    stats.fps.value = 1000 / (now - stats.fps.lastTime);
    stats.fps.lastTime = now;
    if (ui.metrics.fps) ui.metrics.fps.textContent = stats.fps.value.toFixed(1);
    if (ui.metrics.particles) ui.metrics.particles.textContent = activeParticleCount.toLocaleString();
    if (ui.metrics.physicsCpu) ui.metrics.physicsCpu.textContent = stats.physicsCpu.value.toFixed(2);
    
    // Measure render time
    const renderStartTime = performance.now();
    composer.render(dt);
    stats.renderTime.value = performance.now() - renderStartTime;
    if (ui.metrics.renderTime) ui.metrics.renderTime.textContent = stats.renderTime.value.toFixed(2);
    
    // Feed metrics to the benchmark controller
    benchmarkController.recordMetrics(stats.fps.value, stats.renderTime.value, stats.physicsCpu.value);

    // Update and draw graphs
    updatePerfGraph(perfHistory.cpu, stats.physicsCpu.value, ui.metrics.cpuGraph, '#ff5555');
    updatePerfGraph(perfHistory.gpu, stats.renderTime.value, ui.metrics.gpuGraph, '#00ffcc');

    benchmarkController.update(performance.now());
    
    diskMaterial.uniforms.uTime.value = elapsedTime;
    nebulaMaterials.forEach(m => m.uniforms.uTime.value = elapsedTime);
    if (filmPass) filmPass.uniforms.time.value = elapsedTime;

    moon.position.set(
        Math.cos(elapsedTime * 0.1) * MOON_ORBIT_RADIUS,
        0,
        Math.sin(elapsedTime * 0.1) * MOON_ORBIT_RADIUS
    );
    
    updateParticles(activeParticleCount, elapsedTime);
    updateJets(dt);

    controls.update();

    // ------------------------------------------------------------------
    // After rendering, hand the buffer back to the worker for the next
    // physics step. This guarantees the buffer is **not** detached until
    // we've finished using it for this frame.
    // ------------------------------------------------------------------
    if (bufferReady && dataView && dataView.buffer.byteLength > 0) {
        const message = {
            type: 'physics_update',
            buffer: dataView.buffer,
            moon_x: moon.position.x,
            moon_y: moon.position.y,
            moon_z: moon.position.z,
        };

        // Piggy-back any simulation state changes requested by the UI or
        // benchmark controller.
        if (stateChanged) {
            message.particleCount = simState.particleCount;
            message.bhMass = simState.bhMass;
            message.quality = simState.physicsQuality;
            stateChanged = false;
        }

        stats.physicsCpu.lastTime = performance.now();
        physicsWorker.postMessage(message, [dataView.buffer]);
        bufferReady = false; // Will be set true when the worker responds
    }
}

function updatePerfGraph(history, value, canvas, color) {
    // Add new value and remove oldest
    history.push(value);
    if (history.length > 100) history.shift();

    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;
    const maxVal = Math.max(...history) * 1.1; // Add 10% padding

    ctx.clearRect(0, 0, w, h);
    ctx.beginPath();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    
    history.forEach((val, i) => {
        const x = (i / (history.length -1)) * w;
        const y = h - (val / maxVal) * h;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
    });
    ctx.stroke();
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
    jets.geometry.attributes.position.needsUpdate = true;
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