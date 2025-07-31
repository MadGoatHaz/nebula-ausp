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
    filmPass, jets, jetParticles, gui, stars, updateStars
} = createScene(mainGui);
document.body.appendChild(renderer.domElement);

const clock = new THREE.Clock();
const stats = {
    fps: { value: 0, smoothing: 0.9, lastTime: 0 },
    renderTime: { value: 0, smoothing: 0.9 },
    physicsCpu: { value: 0, smoothing: 0.9, lastTime: performance.now() },
    particles: { value: 0 },
    consumed: { value: 0 }
};
let systemCapabilities = {};
let lastStarUpdate = 0;
const STAR_UPDATE_INTERVAL = 100; // Update stars every 100ms (10 FPS) instead of every frame

// Fixed timestep for physics updates
const FIXED_TIMESTEP = 1/60; // 60 FPS physics
let accumulator = 0;
let lastTime = 0;

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

// Particle management system
let particleResetInProgress = false;
let pendingParticleReset = null;

// Debouncing for particle slider
let particleSliderTimeout = null;
const PARTICLE_SLIDER_DEBOUNCE = 100; // 100ms debounce

// Function to safely reset particles with proper synchronization
async function resetParticlesSafely(newParticleCount) {
    console.log(`[main] resetParticlesSafely called with ${newParticleCount} particles`);
    
    if (particleResetInProgress) {
        console.log(`[main] Particle reset already in progress, queuing ${newParticleCount}`);
        // Queue the reset request
        pendingParticleReset = newParticleCount;
        return;
    }
    
    particleResetInProgress = true;
    console.log(`[main] Starting particle reset for ${newParticleCount} particles`);
    
    try {
        // Send reset command to worker
        stateChanged = true;
        simState.particleCount = newParticleCount;
        console.log(`[main] Set stateChanged=true and simState.particleCount=${newParticleCount}`);
        
        // Wait for worker to confirm the reset
        console.log(`[main] Waiting for worker to confirm particle reset...`);
        await new Promise((resolve) => {
            resolveStateUpdate = resolve;
        });
        console.log(`[main] Worker confirmed particle reset complete`);
        
        // Update UI
        if (ui.sandboxControls.particleCountLabel) {
            ui.sandboxControls.particleCountLabel.textContent = newParticleCount.toLocaleString();
        }
        
        // Update slider if it exists and doesn't match
        if (ui.sandboxControls.particles && ui.sandboxControls.particles.value != newParticleCount) {
            ui.sandboxControls.particles.value = newParticleCount;
        }
        
        console.log(`[main] Particle reset UI updated`);
        
    } catch (error) {
        console.error("Error resetting particles:", error);
        log.addEvent('error', {
            type: 'particle_reset',
            message: error.message,
            stack: error.stack
        });
    } finally {
        particleResetInProgress = false;
        console.log(`[main] Particle reset process completed`);
        
        // Process pending reset if exists
        if (pendingParticleReset !== null) {
            const nextReset = pendingParticleReset;
            pendingParticleReset = null;
            console.log(`[main] Processing queued particle reset for ${nextReset}`);
            resetParticlesSafely(nextReset);
        }
    }
}

// Function to initialize particles with proper error handling
async function initializeParticles() {
    try {
        console.log('[main] Initializing particles with count:', simState.particleCount);
        
        // Reset particle state
        activeParticleCount = 0;
        stats.consumed.value = 0;
        
        // Reset particle instances
        if (particleInstances) {
            particleInstances.count = 0;
            particleInstances.instanceMatrix.needsUpdate = true;
        }
        
        // Reset UI counters
        if (ui.metrics.particles) {
            ui.metrics.particles.textContent = '0';
        }
        
        // Send initialization to worker
        await resetParticlesSafely(simState.particleCount);
        
        console.log('[main] Particle initialization complete');
        
    } catch (error) {
        console.error("Error initializing particles:", error);
        log.addEvent('error', {
            type: 'particle_initialization',
            message: error.message,
            stack: error.stack
        });
        throw error;
    }
}

// --- Animation-Scoped Temp Variables ---
// These are declared outside the animation loop to avoid re-creation on every frame.
const _tempObject = new THREE.Object3D();
const _tempColor = new THREE.Color();

// --- MAIN ---
async function main() {
    try {
        ui.versionInfo.textContent = `v${packageJson.version}`;
        systemCapabilities = await detectCapabilities(renderer);
        systemCapabilities.version = packageJson.version; // Add version to system capabilities
        console.log("System Capabilities:", systemCapabilities);
        
        // Log system capabilities detection
        log.addEvent('system_detection_complete', { capabilities: systemCapabilities });
        
        // Populate System Info panel with detailed information
        if (ui.systemInfo.cpu) ui.systemInfo.cpu.textContent = `${systemCapabilities.cpuCores} Cores`;
        if (ui.systemInfo.gpu) ui.systemInfo.gpu.textContent = systemCapabilities.gpuRenderer;
    } catch (error) {
        console.error("Error during system initialization:", error);
        log.addEvent('error', {
            type: 'system_initialization',
            message: error.message,
            stack: error.stack
        });
        alert("Failed to initialize system capabilities. Please check the console for details.");
        return;
    }
    
    // Populate System Info panel with detailed information
    if (ui.systemInfo.cpu) ui.systemInfo.cpu.textContent = `${systemCapabilities.cpuCores} Cores`;
    if (ui.systemInfo.gpu) ui.systemInfo.gpu.textContent = systemCapabilities.gpuRenderer;
    
    // Add more detailed system info if UI elements exist
    const systemInfoPanel = document.getElementById('system-info-panel');
    if (systemInfoPanel) {
        const additionalInfo = document.createElement('div');
        additionalInfo.className = 'system-details';
        
        // Basic system info
        let systemInfoHTML = `
            <div>OS: <strong>${systemCapabilities.os}</strong></div>
            <div>Browser: <strong>${systemCapabilities.browser} ${systemCapabilities.browserVersion}</strong></div>
            <div>Screen: <strong>${systemCapabilities.screenResolution}</strong></div>
            <div>Memory: <strong>${systemCapabilities.memory || 'Unknown'} GB</strong></div>
        `;
        
        // Advanced capabilities for Phase 3 development
        systemInfoHTML += `<div class="advanced-capabilities-header">Advanced Capabilities:</div>`;
        
        // WebAssembly support
        if (systemCapabilities.hasWasm) {
            systemInfoHTML += `<div>WebAssembly: <strong class="capability-supported">✓ Supported</strong></div>`;
            if (systemCapabilities.hasWasmSIMD) {
                systemInfoHTML += `<div style="margin-left: 15px;">SIMD: <strong class="capability-supported">✓ Supported</strong></div>`;
            } else {
                systemInfoHTML += `<div style="margin-left: 15px;">SIMD: <strong class="capability-unsupported">✗ Not Supported</strong></div>`;
            }
            if (systemCapabilities.hasWasmThreads) {
                systemInfoHTML += `<div style="margin-left: 15px;">Threads: <strong class="capability-supported">✓ Supported</strong></div>`;
            } else {
                systemInfoHTML += `<div style="margin-left: 15px;">Threads: <strong class="capability-unsupported">✗ Not Supported</strong></div>`;
            }
        } else {
            systemInfoHTML += `<div>WebAssembly: <strong class="capability-unsupported">✗ Not Supported</strong></div>`;
        }
        
        // WebGPU support
        if (systemCapabilities.hasWebGpu) {
            systemInfoHTML += `<div>WebGPU: <strong class="capability-supported">✓ Supported</strong></div>`;
            if (systemCapabilities.hasRayTracing) {
                systemInfoHTML += `<div style="margin-left: 15px;">Ray Tracing: <strong class="capability-supported">✓ Supported</strong></div>`;
            } else {
                systemInfoHTML += `<div style="margin-left: 15px;">Ray Tracing: <strong class="capability-unsupported">✗ Not Supported</strong></div>`;
            }
        } else {
            systemInfoHTML += `<div>WebGPU: <strong class="capability-unsupported">✗ Not Supported</strong></div>`;
        }
        
        additionalInfo.innerHTML = systemInfoHTML;
        systemInfoPanel.appendChild(additionalInfo);
    }
    
    // Create particle instances mesh
    const particleMaterial = new THREE.ShaderMaterial({
        uniforms: {
            uTime: { value: 0.0 },
        },
        vertexShader: `
            #ifdef GL_OES_standard_derivatives
            #extension GL_OES_standard_derivatives : enable
            #endif
            
            attribute vec3 instanceColor;
            attribute vec3 instanceVelocity;
            varying vec3 vColor;
            varying float vSpeed;
            varying vec3 vViewPosition;
            
            void main() {
                vColor = instanceColor;
                vSpeed = length(instanceVelocity);
                vec3 p = position;
                if (vSpeed > 1.0) {
                   vec3 dir = normalize(instanceVelocity);
                   p += dir * vSpeed * 0.01; // Motion blur
                }
                
                vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4(p, 1.0);
                vViewPosition = mvPosition.xyz;
                gl_Position = projectionMatrix * mvPosition;
                
                // Apply conservative depth offset based on speed to reduce z-fighting
                gl_Position.z += clamp(log(vSpeed + 1.0) * 0.0001, -0.001, 0.001) * gl_Position.w;
            }
        `,
        fragmentShader: `
            #ifdef GL_OES_standard_derivatives
            #extension GL_OES_standard_derivatives : enable
            #endif
            
            precision highp float;
            
            varying vec3 vColor;
            varying float vSpeed;
            varying vec3 vViewPosition;
            
            void main() {
                // Use smooth alpha falloff to reduce edge flicker
                float alpha = 1.0;
                #ifdef GL_OES_standard_derivatives
                float antialias = fwidth(vSpeed);
                alpha = smoothstep(0.0, max(antialias, 0.1), vSpeed);
                #endif
                
                // Apply distance-based alpha to reduce overdraw and flickering
                float distanceFade = 1.0 - smoothstep(15000.0, 20000.0, length(vViewPosition));
                alpha *= distanceFade;
                
                // Discard very transparent fragments to reduce overdraw
                if (alpha < 0.01) discard;
                
                gl_FragColor = vec4(vColor * 1.5, alpha); // Boost color for bloom with smooth alpha
            }
        `,
        transparent: true,
        depthWrite: false, // Don't write to depth buffer to avoid z-fighting
        depthTest: true,   // Do depth testing
        blending: THREE.AdditiveBlending
    });
    
    const particleGeometry = new THREE.IcosahedronGeometry(5, 0);
    // Add instanced attributes
    instanceColorAttribute = new THREE.InstancedBufferAttribute(new Float32Array(MAX_PARTICLES * 3), 3);
    instanceVelocityAttribute = new THREE.InstancedBufferAttribute(new Float32Array(MAX_PARTICLES * 3), 3);
    particleGeometry.setAttribute('instanceColor', instanceColorAttribute);
    particleGeometry.setAttribute('instanceVelocity', instanceVelocityAttribute);

    particleInstances = new THREE.InstancedMesh(particleGeometry, particleMaterial, MAX_PARTICLES);
    particleInstances.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    particleInstances.renderOrder = 10; // Render particles after jets and other elements
    scene.add(particleInstances);

    console.log('[main] Awaiting first message from worker...');
    physicsWorker.onmessage = (e) => {
        console.log(`[main] Received message from worker: ${e.data.type}`, e.data);
        
        // Handle non-buffer messages separately ---------------------------
        if (!e.data.buffer) {
            switch (e.data.type) {
                case 'state_updated':
                    console.log('[main] Received state_updated from worker');
                    if (resolveStateUpdate) {
                        console.log('[main] Resolving state update promise');
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
        console.log(`[main] Creating Float32Array from buffer, byteLength: ${e.data.buffer.byteLength}`);
        dataView = new Float32Array(e.data.buffer);
        console.log(`[main] dataView created, length: ${dataView.length}`);
        
        switch (e.data.type) {
            case 'initialized':
                console.log('[main] Worker initialized, starting render loop and particle initialization');
                // Worker is ready, kick off the render loop. We will send the first
                // physics_update after the first animation frame so the render loop
                // gets at least one buffer to draw.
                bufferReady = true; // Ready to send first update during first frame
                console.log('[main] bufferReady set to true');
                
                // Initialize particles
                console.log('[main] Calling initializeParticles()');
                initializeParticles().catch(error => {
                    console.error("Failed to initialize particles:", error);
                });
                
                renderLoop();
                break;
                
            case 'physics_update':
                console.log(`[main] Received physics_update, particleCount: ${e.data.particleCount}, consumed: ${e.data.consumedParticles}`);
                // Physics step finished; we now own the buffer until we hand it back.
                stats.physicsCpu.value = performance.now() - stats.physicsCpu.lastTime;
                activeParticleCount = e.data.particleCount;
                stats.consumed.value = e.data.consumedParticles;
                
                bufferReady = true; // Flag for the render loop
                console.log('[main] bufferReady set to true after physics_update');
                break;
        }
    };

    // --- EVENT LISTENERS ---
    ui.toggleControlsBtn.addEventListener('click', () => {
        mainGui.show(mainGui._hidden);
    });

    ui.downloadLogBtn.addEventListener('click', () => {
        try {
            log.download();
        } catch (error) {
            console.error("Failed to download log:", error);
            log.addEvent('error', {
                type: 'log_download',
                message: error.message,
                stack: error.stack
            });
            alert("Failed to download log. Please check the console for details.");
        }
    });

    ui.submitScoreBtn.addEventListener('click', () => {
        ui.submissionModal.backdrop.classList.remove('hidden');
        ui.submissionModal.scoreSummary.textContent = `Final Score: ${benchmarkController.finalScore}`;
        
        // Create detailed system summary
        let systemSummaryHTML = `
            <strong>CPU:</strong> ${systemCapabilities.cpuCores} Cores<br>
            <strong>GPU:</strong> ${systemCapabilities.gpuRenderer}<br>
            <strong>OS:</strong> ${systemCapabilities.os}<br>
            <strong>Browser:</strong> ${systemCapabilities.browser} ${systemCapabilities.browserVersion}<br>
        `;
        
        if (systemCapabilities.memory) {
            systemSummaryHTML += `<strong>Memory:</strong> ${systemCapabilities.memory} GB<br>`;
        }
        
        ui.submissionModal.systemSummary.innerHTML = systemSummaryHTML;
    });

    ui.submissionModal.cancelBtn.addEventListener('click', () => {
        ui.submissionModal.backdrop.classList.add('hidden');
    });

    ui.submissionModal.submitBtn.addEventListener('click', async () => {
        const nameInput = document.getElementById('submitter-name');
        const name = nameInput.value.trim() || 'Anonymous';
        
        // Show loading message
        const messageEl = document.getElementById('modal-message');
        messageEl.className = 'modal-message loading';
        messageEl.textContent = 'Submitting score...';
        messageEl.classList.remove('hidden');
        
        // Disable buttons during submission
        ui.submissionModal.submitBtn.disabled = true;
        ui.submissionModal.cancelBtn.disabled = true;

        const submissionData = {
            name: name,
            score: benchmarkController.finalScore,
            system: {
                gpu: systemCapabilities.gpuRenderer,
                cpuCores: systemCapabilities.cpuCores,
                os: systemCapabilities.os,
                browser: systemCapabilities.browser,
                browserVersion: systemCapabilities.browserVersion,
                memory: systemCapabilities.memory,
                screenResolution: systemCapabilities.screenResolution,
                architecture: systemCapabilities.architecture || 'Unknown',
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
                messageEl.className = 'modal-message success';
                messageEl.textContent = `Score submitted successfully! Your rank is #${result.rank}.`;
                
                // Re-enable buttons after a delay
                setTimeout(() => {
                    ui.submissionModal.backdrop.classList.add('hidden');
                    ui.submissionModal.submitBtn.disabled = false;
                    ui.submissionModal.cancelBtn.disabled = false;
                    messageEl.classList.add('hidden');
                    nameInput.value = ''; // Clear the input
                }, 2000);
            } else {
                throw new Error(`Server error: ${response.status}`);
            }
        } catch (error) {
            console.error("Failed to submit score:", error);
            messageEl.className = 'modal-message error';
            messageEl.textContent = 'Failed to submit score. Please try again.';
            ui.submissionModal.submitBtn.disabled = false;
            ui.submissionModal.cancelBtn.disabled = false;
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
            const onBenchmarkStateChange = async (newState) => {
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
        const newParticleCount = parseInt(e.target.value, 10);
        
        // Update label immediately for responsiveness
        if (ui.sandboxControls.particleCountLabel) {
            ui.sandboxControls.particleCountLabel.textContent = newParticleCount.toLocaleString();
        }
        
        // Clear previous timeout
        if (particleSliderTimeout) {
            clearTimeout(particleSliderTimeout);
        }
        
        // Debounce the actual particle reset
        particleSliderTimeout = setTimeout(() => {
            resetParticlesSafely(newParticleCount).catch(error => {
                console.error("Failed to reset particles:", error);
            });
        }, PARTICLE_SLIDER_DEBOUNCE);
    });

    ui.sandboxControls.bhMass.addEventListener('input', (e) => {
        simState.bhMass = parseInt(e.target.value, 10);
        stateChanged = true;
    });

    ui.sandboxControls.physicsQuality.addEventListener('change', (e) => {
        simState.physicsQuality = e.target.value;
        stateChanged = true;
    });
    
    // Add scenario preset event listener
    if (ui.sandboxControls.scenario) {
        ui.sandboxControls.scenario.addEventListener('change', (e) => {
            const scenario = e.target.value;
            if (!scenario) return;
            
            // Apply scenario presets
            switch (scenario) {
                case 'quiet':
                    // Quiet Solitude: Low particle count, low BH mass
                    simState.particleCount = 5000;
                    simState.bhMass = 200000;
                    simState.physicsQuality = 'simple';
                    break;
                case 'active':
                    // Active Accretion: Medium particle count, medium BH mass
                    simState.particleCount = 25000;
                    simState.bhMass = 400000;
                    simState.physicsQuality = 'complex';
                    break;
                case 'complex':
                    // Complex Dance: High particle count, high BH mass
                    simState.particleCount = 50000;
                    simState.bhMass = 600000;
                    simState.physicsQuality = 'complex';
                    break;
                case 'extreme':
                    // Extreme Collision: Maximum particle count, maximum BH mass, collision physics
                    simState.particleCount = 100000;
                    simState.bhMass = 800000;
                    simState.physicsQuality = 'extreme';
                    break;
                default:
                    return;
            }
            
            // Update UI controls to match scenario
            if (ui.sandboxControls.particles) {
                ui.sandboxControls.particles.value = simState.particleCount;
            }
            if (ui.sandboxControls.particleCountLabel) {
                ui.sandboxControls.particleCountLabel.textContent = simState.particleCount.toLocaleString();
            }
            if (ui.sandboxControls.bhMass) {
                ui.sandboxControls.bhMass.value = simState.bhMass;
            }
            if (ui.sandboxControls.physicsQuality) {
                ui.sandboxControls.physicsQuality.value = simState.physicsQuality;
            }
            
            // Apply the scenario settings
            stateChanged = true;
            
            // Reset particles with new settings
            resetParticlesSafely(simState.particleCount).catch(error => {
                console.error("Failed to reset particles for scenario:", error);
            });
        });
    }

    ui.sandboxControls.resetCameraBtn.addEventListener('click', () => {
        controls.reset();
        camera.position.set(0, 1000, 2500);
    });

    // Initialize and start the worker
    physicsWorker.postMessage({ type: 'init', maxParticles: MAX_PARTICLES });
}

let bufferReady = false; // Indicates we have a buffer ready for this frame
let initialBufferReceived = false; // Track if we've received the initial buffer

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
    
    // Fixed timestep for physics updates
    accumulator += dt;
    while (accumulator >= FIXED_TIMESTEP) {
        // Physics updates happen at fixed intervals
        accumulator -= FIXED_TIMESTEP;
    }
    
    const elapsedTime = clock.getElapsedTime();

    // Update stats
    stats.fps.value = 1000 / (now - stats.fps.lastTime);
    stats.fps.lastTime = now;
    if (ui.metrics.fps) ui.metrics.fps.textContent = stats.fps.value.toFixed(1);
    if (ui.metrics.particles) ui.metrics.particles.textContent = activeParticleCount.toLocaleString();
    if (ui.metrics.consumed) ui.metrics.consumed.textContent = stats.consumed.value.toLocaleString();
    if (ui.metrics.physicsCpu) ui.metrics.physicsCpu.textContent = stats.physicsCpu.value.toFixed(2);
    
    // Measure render time
    const renderStartTime = performance.now();
    // Render stars directly before composer
    if (stars) {
        renderer.render(scene, camera);
    }
    composer.render(dt);
    stats.renderTime.value = performance.now() - renderStartTime;
    if (ui.metrics.renderTime) ui.metrics.renderTime.textContent = stats.renderTime.value.toFixed(2);
    
    // Measure memory usage
    if (ui.metrics.memory) {
        if (performance.memory) {
            const usedMB = Math.round(performance.memory.usedJSHeapSize / 1048576);
            ui.metrics.memory.textContent = usedMB;
        } else {
            ui.metrics.memory.textContent = 'N/A';
        }
    }
    
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
    
    // Update stars at a lower frame rate to reduce performance impact
    const currentTime = performance.now();
    if (currentTime - lastStarUpdate > STAR_UPDATE_INTERVAL && updateStars) {
        updateStars(dt);
        lastStarUpdate = currentTime;
    }
    
    updateParticles(activeParticleCount, elapsedTime);
    updateJets(dt);

    controls.update();

    // ------------------------------------------------------------------
    // After rendering, hand the buffer back to the worker for the next
    // physics step. This guarantees the buffer is **not** detached until
    // we've finished using it for this frame.
    // ------------------------------------------------------------------
    if (bufferReady && dataView && dataView.buffer.byteLength > 0) {
        console.log(`[main] Sending buffer back to worker, byteLength: ${dataView.buffer.byteLength}`);
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
            console.log(`[main] Sending state changes: particleCount=${simState.particleCount}, bhMass=${simState.bhMass}, quality=${simState.physicsQuality}`);
            message.particleCount = simState.particleCount;
            message.bhMass = simState.bhMass;
            message.quality = simState.physicsQuality;
            stateChanged = false;
        }
        
        stats.physicsCpu.lastTime = performance.now();
        physicsWorker.postMessage(message, [dataView.buffer]);
        bufferReady = false; // Will be set true when the worker responds
        console.log(`[main] Buffer sent to worker, bufferReady set to false`);
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
    const minVal = Math.min(...history);

    ctx.clearRect(0, 0, w, h);
    
    // Draw grid lines
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
    ctx.lineWidth = 0.5;
    
    // Horizontal grid lines
    for (let i = 0; i <= 5; i++) {
        const y = (h / 5) * i;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
        ctx.stroke();
    }
    
    // Draw graph line
    ctx.beginPath();
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    
    history.forEach((val, i) => {
        const x = (i / (history.length - 1)) * w;
        const y = h - ((val - minVal) / (maxVal - minVal)) * h;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
    });
    ctx.stroke();
    
    // Draw filled area under the curve for better visualization
    if (history.length > 1) {
        ctx.beginPath();
        ctx.moveTo(0, h);
        history.forEach((val, i) => {
            const x = (i / (history.length - 1)) * w;
            const y = h - ((val - minVal) / (maxVal - minVal)) * h;
            ctx.lineTo(x, y);
        });
        ctx.lineTo(w, h);
        ctx.closePath();
        
        // Create gradient fill
        const gradient = ctx.createLinearGradient(0, 0, 0, h);
        gradient.addColorStop(0, color.replace(')', ', 0.3)').replace('rgb', 'rgba'));
        gradient.addColorStop(1, color.replace(')', ', 0.05)').replace('rgb', 'rgba'));
        ctx.fillStyle = gradient;
        ctx.fill();
    }
    
    // Draw current value indicator
    if (history.length > 0) {
        const currentValue = history[history.length - 1];
        const x = w - 1;
        const y = h - ((currentValue - minVal) / (maxVal - minVal)) * h;
        
        // Draw dot at current value
        ctx.beginPath();
        ctx.fillStyle = color;
        ctx.arc(x, y, 3, 0, Math.PI * 2);
        ctx.fill();
        
        // Draw value label
        ctx.fillStyle = 'white';
        ctx.font = '10px monospace';
        ctx.textAlign = 'right';
        ctx.fillText(currentValue.toFixed(2), w - 5, y - 5);
    }
    
    // Draw min/max labels
    ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
    ctx.font = '8px monospace';
    ctx.textAlign = 'left';
    ctx.fillText(maxVal.toFixed(2), 2, 10);
    ctx.fillText(minVal.toFixed(2), 2, h - 2);
}

// Reusable vectors to reduce garbage collection
const _tempVector1 = new THREE.Vector3();
const _tempVector2 = new THREE.Vector3();
const _tempSphere = new THREE.Sphere();

function updateParticles(particleCount, elapsedTime) {
    // Safety check for data availability
    if (!dataView || particleCount > MAX_PARTICLES) {
        if (particleInstances) {
            particleInstances.count = 0;
            particleInstances.instanceMatrix.needsUpdate = true;
        }
        // Always update jets geometry to ensure they're visible
        if (jets && jets.geometry && jets.geometry.attributes.position) {
            jets.geometry.attributes.position.needsUpdate = true;
        }
        return;
    }
    
    // Handle 0 particle case explicitly
    if (particleCount <= 0) {
        if (particleInstances) {
            particleInstances.count = 0;
            particleInstances.instanceMatrix.needsUpdate = true;
        }
        // Always update jets geometry to ensure they're visible
        if (jets && jets.geometry && jets.geometry.attributes.position) {
            jets.geometry.attributes.position.needsUpdate = true;
        }
        return;
    }
    
    const baseHue = 0.6; // Blueish
    const hueVariance = 0.1;
    
    // Limit particle count to prevent performance issues
    const safeParticleCount = Math.min(particleCount, MAX_PARTICLES);
    
    // Camera frustum for culling - calculate once outside loop
    const frustum = new THREE.Frustum();
    const projScreenMatrix = new THREE.Matrix4();
    projScreenMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    frustum.setFromProjectionMatrix(projScreenMatrix);
    
    // LOD parameters
    const cameraPos = camera.position;
    const maxDistance = 20000; // Maximum distance for rendering
    const lodDistance1 = 5000;  // Distance for full detail
    const lodDistance2 = 10000; // Distance for reduced detail
    const distanceSquared1 = lodDistance1 * lodDistance1;
    const distanceSquared2 = lodDistance2 * lodDistance2;
    const maxDistanceSquared = maxDistance * maxDistance;
    
    let visibleParticles = 0;
    
    // Pre-allocate arrays for visible particles only
    const maxVisibleParticles = Math.min(safeParticleCount, 100000); // Cap to prevent memory issues
    const positions = new Float32Array(maxVisibleParticles * 3);
    const colors = new Float32Array(maxVisibleParticles * 3);
    const velocities = new Float32Array(maxVisibleParticles * 3);
    
    for (let i = 0; i < safeParticleCount && visibleParticles < maxVisibleParticles; i++) {
        const offset = i * PARTICLE_STRIDE;
        
        // Position
        const x = dataView[offset];
        const y = dataView[offset + 1];
        const z = dataView[offset + 2];
        
        // Skip consumed particles (marked with x > 99998)
        if (x > 99998) {
            continue;
        }
        
        // Quick distance check using squared distance to avoid sqrt
        _tempVector1.set(x, y, z);
        const distanceSquared = _tempVector1.distanceToSquared(cameraPos);
        
        // Skip particles that are too far away
        if (distanceSquared > maxDistanceSquared) {
            continue;
        }
        
        // LOD - reduce detail based on distance
        let shouldRender = true;
        if (distanceSquared > distanceSquared2) {
            // Every 4th particle at far distance
            if (i % 4 !== 0) {
                shouldRender = false;
            }
        } else if (distanceSquared > distanceSquared1) {
            // Every 2nd particle at medium distance
            if (i % 2 !== 0) {
                shouldRender = false;
            }
        }
        
        if (!shouldRender) {
            continue;
        }
        
        // Frustum culling - check if particle is in view
        _tempSphere.set(_tempVector1, 10); // Particle radius
        if (!frustum.intersectsSphere(_tempSphere)) {
            continue;
        }
        
        positions[visibleParticles * 3] = x;
        positions[visibleParticles * 3 + 1] = y;
        positions[visibleParticles * 3 + 2] = z;
        
        // Velocity
        const vx = dataView[offset + 3];
        const vy = dataView[offset + 4];
        const vz = dataView[offset + 5];
        velocities[visibleParticles * 3] = vx;
        velocities[visibleParticles * 3 + 1] = vy;
        velocities[visibleParticles * 3 + 2] = vz;
        
        // Color based on speed and distance (LOD)
        const speed = Math.sqrt(vx * vx + vy * vy + vz * vz);
        const hue = baseHue + (visibleParticles % 20 / 20) * hueVariance;
        
        // Reduce color intensity for distant particles
        let saturation = Math.max(0.2, 1.0 - speed / 400);
        let lightness = Math.min(1.0, 0.4 + speed / 200.0);
        
        // Apply LOD color reduction using squared distances for consistency
        if (distanceSquared > distanceSquared2) {
            saturation *= 0.7;
            lightness *= 0.7;
        } else if (distanceSquared > distanceSquared1) {
            saturation *= 0.85;
            lightness *= 0.85;
        }
        
        _tempColor.setHSL(hue, saturation, lightness);
        colors[visibleParticles * 3] = _tempColor.r;
        colors[visibleParticles * 3 + 1] = _tempColor.g;
        colors[visibleParticles * 3 + 2] = _tempColor.b;
        
        visibleParticles++;
    }
    
    // Update particle instances with batched data
    if (particleInstances) {
        // Update positions using matrices
        for (let i = 0; i < visibleParticles; i++) {
            _tempObject.position.set(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]);
            _tempObject.updateMatrix();
            particleInstances.setMatrixAt(i, _tempObject.matrix);
        }
        
        particleInstances.count = visibleParticles;
        particleInstances.instanceMatrix.needsUpdate = true;
    }
    
    // Update attributes directly for better performance
    if (instanceColorAttribute && instanceVelocityAttribute) {
        // Update color attributes
        for (let i = 0; i < visibleParticles; i++) {
            const colorOffset = i * 3;
            instanceColorAttribute.setXYZ(
                i,
                colors[colorOffset],
                colors[colorOffset + 1],
                colors[colorOffset + 2]
            );
        }
        
        // Update velocity attributes
        for (let i = 0; i < visibleParticles; i++) {
            const velocityOffset = i * 3;
            instanceVelocityAttribute.setXYZ(
                i,
                velocities[velocityOffset],
                velocities[velocityOffset + 1],
                velocities[velocityOffset + 2]
            );
        }
        
        // Mark attributes as needing update
        instanceColorAttribute.needsUpdate = true;
        instanceVelocityAttribute.needsUpdate = true;
    }
    
    // Update jets geometry
    if (jets && jets.geometry && jets.geometry.attributes.position) {
        jets.geometry.attributes.position.needsUpdate = true;
    }
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