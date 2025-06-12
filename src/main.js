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
    accretionDisk, diskMaterial, moon, nebulaMaterials,
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

// This object will hold the latest state from the UI controls.
const simState = {
    particleCount: 10000,
    bhMass: 400000,
    physicsQuality: 'simple',
};
let stateChanged = false; // Flag to indicate if we need to send updates

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
        if (!e.data.buffer) {
            // Handle non-buffer messages like benchmark updates separately
            switch (e.data.type) {
                case 'benchmark_update':
                    benchmarkController.handleWorkerUpdate(e.data.payload, log);
                    ui.benchmarkStatusEl.textContent = benchmarkController.state;
                    if (benchmarkController.state === State.SEARCHING_MAX_Q) {
                        ui.metrics.fps.textContent = e.data.payload.fps.toFixed(1);
                    }
                    return; // Don't proceed to buffer logic
                 case 'benchmark_complete':
                    benchmarkController.handleCompletion(e.data.results, systemCapabilities, log);
                    ui.benchmarkStatusEl.textContent = 'Benchmark Complete. Ready for next run.';
                    ui.submitScoreBtn.disabled = false;
                    return; // Don't proceed to buffer logic
                 case 'worker_error':
                    console.error("Received error from worker:", e.data.error);
                    alert(`Physics worker crashed!\\n\\nMessage: ${e.data.error.message}`);
                    return; // Don't proceed to buffer logic
            }
        }
        
        // --- Buffer-based message handling ---
        dataView = new Float32Array(e.data.buffer);

        switch (e.data.type) {
            case 'initialized':
                // Worker is ready, kick off the render loop and the first physics step.
                renderLoop(); // Start the continuous render loop.
                
                physicsWorker.postMessage({
                    type: 'physics_update',
                    buffer: dataView.buffer,
                    particleCount: simState.particleCount,
                    bhMass: simState.bhMass,
                    quality: simState.physicsQuality,
                    moon_x: moon.position.x,
                    moon_y: moon.position.y,
                    moon_z: moon.position.z,
                }, [dataView.buffer]);
                break;
                
            case 'physics_update':
                // Physics step is complete. Update state and kick off the next physics step immediately.
                // The rendering is happening independently in the renderLoop.
                activeParticleCount = e.data.particleCount;
                stats.consumed.value = e.data.consumedParticles;
                
                const message = {
                    type: 'physics_update',
                    buffer: dataView.buffer,
                    moon_x: moon.position.x,
                    moon_y: moon.position.y,
                    moon_z: moon.position.z,
                };

                // Piggy-back state changes if they have occurred
                if (stateChanged) {
                    message.particleCount = simState.particleCount;
                    message.bhMass = simState.bhMass;
                    message.quality = simState.physicsQuality;
                    stateChanged = false; // Reset the flag
                }
                
                physicsWorker.postMessage(message, [dataView.buffer]);
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
            
            // This is the new callback function for the benchmark controller
            const onBenchmarkStateChange = (newState) => {
                simState.physicsQuality = newState.quality;
                simState.particleCount = newState.particleCount;
                stateChanged = true;
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