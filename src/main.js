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

// Debug flags (kept false in normal builds)
const DEBUG_LEADERBOARD = false;

 // Hot-path tuning constants (safe, tweakable)
 const MAX_VISIBLE_UPDATES_PER_FRAME = 50000;
 // Longer history for smoother, more readable perf trends
 const PERF_GRAPH_HISTORY = 240;
 const PERF_GRAPH_SMOOTHING = 0.15; // EMA factor for min/max visualization
 const ENABLE_VERBOSE_LOGS = false; // Gate for noisy logs in hot paths

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
 // Using fixed-length ring buffers (Array + index) to avoid reallocations
 const perfHistory = {
     physics: {
         values: new Array(PERF_GRAPH_HISTORY).fill(0),
         index: 0,
         length: 0,
     },
     render: {
         values: new Array(PERF_GRAPH_HISTORY).fill(0),
         index: 0,
         length: 0,
     }
 };

const physicsWorker = new Worker(new URL('./physics/physics.worker.js', import.meta.url), { type: 'module' });

const benchmarkController = new BenchmarkController();
const log = new Log();
let dataView = null;
let particleInstances = null;
let animationFrameId = null;
let activeParticleCount = 0;
let instanceColorAttribute, instanceVelocityAttribute;

// Benchmark / worker readiness
let readyForBenchmark = false;

// Pre-allocated reusable arrays for visible particles to avoid per-frame heap churn.
const MAX_VISIBLE_PARTICLES = 100000;
const visiblePositions = new Float32Array(MAX_VISIBLE_PARTICLES * 3);
const visibleColors = new Float32Array(MAX_VISIBLE_PARTICLES * 3);
const visibleVelocities = new Float32Array(MAX_VISIBLE_PARTICLES * 3);

// This object will hold the latest state from the UI controls.
// bhMass is controlled by:
// - Sandbox BH Mass slider (mapped non-linearly for strong visual impact)
// - BenchmarkController via onBenchmarkStateChange (uses absolute masses)
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
 
 // --- SYSTEM INFO RENDERING ---
 function renderSystemInfo(systemCapabilities, ui, log) {
     if (!systemCapabilities || !ui || !ui.systemInfo) return;
 
     const {
         cpuCores,
         cpuThreads,
         cpuModel,
         gpuRenderer,
         gpuVendor,
         gpuVersion,
         gpuBackend,
         os,
         browser,
         browserVersion,
         memory,
         screenResolution,
         hasWebGl,
         hasWebGl2,
         hasWebGpu,
         hasWasm,
         hasWasmSIMD,
         hasWasmThreads,
         hasRayTracing,
     } = systemCapabilities;
 
     // Helper: safe string checks
     const hasValue = (value) =>
         value !== undefined && value !== null && String(value).trim() !== '';
 
     // CPU display
     let cpuDisplay = 'CPU: Unknown';
     if (hasValue(cpuCores) || hasValue(cpuThreads) || hasValue(cpuModel)) {
         const parts = [];
         if (hasValue(cpuCores)) {
             parts.push(`${cpuCores}c`);
         }
         if (hasValue(cpuThreads) && cpuThreads > cpuCores) {
             parts.push(`${cpuThreads}t`);
         }
         // Shorten very long CPU model strings for the header row
         let cpuModelShort = '';
         if (hasValue(cpuModel)) {
             cpuModelShort = String(cpuModel).replace(/\s+/g, ' ').trim();
             if (cpuModelShort.length > 40) {
                 cpuModelShort = cpuModelShort.slice(0, 37).trimEnd() + '…';
             }
         }
         if (parts.length || cpuModelShort) {
             cpuDisplay = `CPU: ${parts.join(' / ')}${cpuModelShort ? ' ' + cpuModelShort : ''}`.trim();
         }
     }
 
     // GPU display
     let gpuDisplay = 'GPU: Unknown';
     if (hasValue(gpuRenderer)) {
         // Start from the raw renderer string
         let gpuRendererShort = String(gpuRenderer).trim();
 
         // Strip verbose ANGLE wrapper if present, keeping the inner renderer
         // e.g. "ANGLE (NVIDIA GeForce RTX 3080 Ti Direct3D11 vs_5_0 ps_5_0)"
         const angleMatch = /^ANGLE\s*\((.+)\)\s*$/i.exec(gpuRendererShort);
         if (angleMatch && hasValue(angleMatch[1])) {
             gpuRendererShort = angleMatch[1].trim();
         }
 
         // Trim excessive whitespace
         gpuRendererShort = gpuRendererShort.replace(/\s+/g, ' ').trim();
 
         // Optionally shorten if extremely verbose while keeping it informative
         if (gpuRendererShort.length > 60) {
             gpuRendererShort = gpuRendererShort.slice(0, 57).trimEnd() + '…';
         }
 
         // Backend/API hint (WebGPU / WebGL2 / WebGL / etc.)
         let backendHint = '';
         if (hasValue(gpuBackend)) {
             backendHint = String(gpuBackend).trim();
         } else if (hasValue(gpuVersion)) {
             backendHint = String(gpuVersion).trim();
         } else if (hasWebGpu) {
             backendHint = 'WebGPU';
         } else if (hasWebGl2) {
             backendHint = 'WebGL2';
         } else if (hasWebGl) {
             backendHint = 'WebGL';
         }
 
         gpuDisplay = `GPU: ${gpuRendererShort}${backendHint ? ` [${backendHint}]` : ''}`;
     }
 
     // RAM / browser / resolution rows
     const memLabel = memory ? `RAM: ${memory} GB` : 'RAM: Unknown';
     const browserLabel = `Browser: ${hasValue(browser) ? browser : 'Unknown'} ${hasValue(browserVersion) ? browserVersion : ''}`.trim();
     const resLabel = `Resolution: ${hasValue(screenResolution) ? screenResolution : 'Unknown'}`;

     // Capability flags
     const webglStatus =
         (hasWebGl || hasWebGl2) ? 'WebGL: Supported' : 'WebGL: Not Supported';
     const webgpuStatus = hasWebGpu ? 'WebGPU: Supported' : 'WebGPU: Not Supported';
     const wasmSimdStatus = hasWasmSIMD ? 'WASM SIMD: Yes' : 'WASM SIMD: No';
     const wasmThreadsStatus = hasWasmThreads ? 'WASM Threads: Yes' : 'WASM Threads: No';
 
     // Prefer a dedicated structured container when available.
     const systemInfoPanel = document.getElementById('system-info-panel');
     if (systemInfoPanel) {
         // Single source of truth:
         // - Clear previous structured content (but keep static headers).
         // - Render one clean block of rows.
         let wrapper = systemInfoPanel.querySelector('.system-info-structured');
         if (!wrapper) {
             wrapper = document.createElement('div');
             wrapper.className = 'system-info-structured';
             systemInfoPanel.appendChild(wrapper);
         }
 
         const cpuValue = cpuDisplay.replace(/^CPU:\s*/, '') || 'Unknown';
         const gpuValue = gpuDisplay.replace(/^GPU:\s*/, '') || 'Unknown';
         const ramValue = memLabel.replace(/^RAM:\s*/, '') || 'Unknown';
         const browserValue = browserLabel.replace(/^Browser:\s*/, '') || 'Unknown';
         const resolutionValue = resLabel.replace(/^Resolution:\s*/, '') || 'Unknown';
 
         wrapper.innerHTML = ''
             + `<div class="system-info-row"><span class="system-info-label">CPU</span><span class="system-info-value">${cpuValue}</span></div>`
             + `<div class="system-info-row"><span class="system-info-label">GPU</span><span class="system-info-value">${gpuValue}</span></div>`
             + `<div class="system-info-row"><span class="system-info-label">RAM</span><span class="system-info-value">${ramValue}</span></div>`
             + `<div class="system-info-row"><span class="system-info-label">Browser</span><span class="system-info-value">${browserValue}</span></div>`
             + `<div class="system-info-row"><span class="system-info-label">Resolution</span><span class="system-info-value">${resolutionValue}</span></div>`
             + `<div class="system-info-row system-info-capabilities"><span class="system-info-label">Key Features</span><span class="system-info-value">${webglStatus} / ${webgpuStatus} / ${wasmSimdStatus} / ${wasmThreadsStatus}</span></div>`;
 
         // Also propagate summary into any designated summary slot inside this panel.
         if (ui.systemInfo.summary) {
             ui.systemInfo.summary.textContent = systemCapabilities.systemSummary || '';
         }
     } else {
         // Legacy flat fields only: populate them directly without creating extra blocks.
         if (ui.systemInfo.cpu) ui.systemInfo.cpu.textContent = cpuDisplay.replace(/^CPU:\s*/, '');
         if (ui.systemInfo.gpu) ui.systemInfo.gpu.textContent = gpuDisplay.replace(/^GPU:\s*/, '');
         if (ui.systemInfo.ram) ui.systemInfo.ram.textContent = memLabel.replace(/^RAM:\s*/, '');
         if (ui.systemInfo.browser) ui.systemInfo.browser.textContent = browserLabel.replace(/^Browser:\s*/, '');
         if (ui.systemInfo.resolution) ui.systemInfo.resolution.textContent = resLabel.replace(/^Resolution:\s*/, '');
         if (ui.systemInfo.capabilities) {
             ui.systemInfo.capabilities.textContent =
                 `${webglStatus} / ${webgpuStatus} / ${wasmSimdStatus} / ${wasmThreadsStatus}`;
         }
     }
 
 
     // Build concise summary used for logs/leaderboard
     const shortParts = [];
     if (cpuCores) shortParts.push(`${cpuCores}c`);
     if (gpuRenderer) {
         // Try to keep this compact; strip obvious prefixes
         let compactGpu = String(gpuRenderer)
             .replace(/^ANGLE\s*\(/, '')
             .replace(/\)$/, '')
             .replace('Direct3D11', 'D3D11')
             .replace('OpenGL', 'GL')
             .replace('Metal', 'MTL')
             .trim();
         shortParts.push(compactGpu.split('/')[0].trim());
     }
     if (memory) shortParts.push(`${memory}GB`);
     if (screenResolution) {
         // Normalize 2560x1440 -> 1440p style when feasible
         const match = /(\d+)\s*x\s*(\d+)/i.exec(screenResolution);
         if (match) {
             const h = parseInt(match[2], 10);
             if (Number.isFinite(h)) shortParts.push(`${h}p`);
         }
     }
     if (browser) {
         const ver = browserVersion ? browserVersion.split('.')[0] : '';
         shortParts.push(`${browser}${ver ? ' ' + ver : ''}`);
     }
 
     const systemSummary = shortParts.join(' / ') || 'Unknown system';
     systemCapabilities.systemSummary = systemSummary;
 
    // Expose to any UI slot for summary (kept in sync with single source of truth above)
    if (ui.systemInfo.summary) {
        ui.systemInfo.summary.textContent = systemSummary;
    }
 
     // Log once for correlation
     if (log) {
         log.addEvent('system_summary', { systemSummary, capabilities: systemCapabilities });
     }
 }

// --- MAIN ---
async function main() {
    try {
        ui.versionInfo.textContent = `v${packageJson.version}`;
        systemCapabilities = await detectCapabilities(renderer);
        systemCapabilities.version = packageJson.version; // Add version to system capabilities
        console.log("System Capabilities:", systemCapabilities);

        // Render structured system info + compute summary
        renderSystemInfo(systemCapabilities, ui, log);

        // Log system capabilities detection with summary
        log.addEvent('system_detection_complete', {
            capabilities: systemCapabilities,
            systemSummary: systemCapabilities.systemSummary || 'Unknown system'
        });
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
        const { type, buffer } = e.data || {};

        // Handle non-buffer messages separately ---------------------------
        if (!buffer) {
            switch (type) {
                case 'state_updated':
                    if (ENABLE_VERBOSE_LOGS) {
                        console.log('[main] Received state_updated from worker');
                    }
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

        // Ignore messages without a valid transferable buffer in the hot path.
        if (!(buffer instanceof ArrayBuffer) || buffer.byteLength === 0) {
            return;
        }

        // Buffer-based messages -----------------------------------------
        if (ENABLE_VERBOSE_LOGS) {
            console.log(
                `[main] Buffer message from worker: ${type}, byteLength=${buffer.byteLength}`
            );
        }

        dataView = new Float32Array(buffer);

        switch (type) {
            case 'initialized':
                console.log('[main] Worker initialized, starting render loop');

                // Worker seeds its own initial particles; we just accept the buffer.
                bufferReady = true;
                initialBufferReceived = true;
                readyForBenchmark = false;
                activeParticleCount = e.data.particleCount || activeParticleCount;

                renderLoop();
                break;

            case 'physics_update':
                // Physics step finished; we now own the buffer until we hand it back.
                stats.physicsCpu.value = performance.now() - stats.physicsCpu.lastTime;
                activeParticleCount = e.data.particleCount || 0;
                stats.consumed.value = e.data.consumedParticles || 0;

                // Mark that we have at least one valid snapshot and that this frame has fresh data.
                initialBufferReceived = true;
                bufferReady = true;

                // Mark system ready once we have a meaningful particle set.
                if (!readyForBenchmark && activeParticleCount >= 5000) {
                    readyForBenchmark = true;
                    console.log('[main] System ready for benchmark.');
                    if (ui.benchmarkStatusEl) {
                        ui.benchmarkStatusEl.textContent = 'Ready for comprehensive benchmark.';
                    }
                }
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
        // Use the authoritative final score from the benchmark controller results
        // to avoid any stale or mismatched values.
        const finalScore =
            benchmarkController.results &&
            typeof benchmarkController.results.finalScore === 'number'
                ? benchmarkController.results.finalScore
                : benchmarkController.finalScore;

        ui.submissionModal.backdrop.classList.remove('hidden');
        ui.submissionModal.scoreSummary.textContent = `Final Score: ${finalScore}`;
        
        // Create detailed system summary using the same helper-derived data
        const summary = systemCapabilities.systemSummary || 'Unknown system';
        let systemSummaryHTML = `
            <strong>Summary:</strong> ${summary}<br>
            <strong>CPU:</strong> ${systemCapabilities.cpuCores ? systemCapabilities.cpuCores + ' Cores' : 'Unknown'}<br>
            <strong>GPU:</strong> ${systemCapabilities.gpuRenderer || 'Unknown'}<br>
            <strong>OS:</strong> ${systemCapabilities.os || 'Unknown'}<br>
            <strong>Browser:</strong> ${systemCapabilities.browser || 'Unknown'} ${systemCapabilities.browserVersion || ''}<br>
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

        // Always take the finalized benchmark score; this prevents sending 0
        // from any stale or shadowed property.
        const finalScoreForSubmit =
            benchmarkController.results &&
            typeof benchmarkController.results.finalScore === 'number'
                ? benchmarkController.results.finalScore
                : benchmarkController.finalScore;

        const submissionData = {
            name: name,
            score: finalScoreForSubmit,
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

        if (DEBUG_LEADERBOARD) {
            console.log('[Leaderboard][client] Submitting payload:', submissionData);
        }

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
            // Cancel current benchmark run
            benchmarkController.cancel(logFunc);
            ui.benchmarkBtn.textContent = 'Run Benchmark';
            ui.benchmarkStatusEl.textContent = 'Ready for standard test.';
            // Re-enable sandbox controls
            for (const key in ui.sandboxControls) {
                const ctrl = ui.sandboxControls[key];
                if (ctrl && 'disabled' in ctrl) ctrl.disabled = false;
            }
            return;
        }

        // Pre-flight: ensure worker & simulation are ready before starting benchmark
        if (!readyForBenchmark || !dataView || activeParticleCount <= 0) {
            logFunc('Benchmark cannot start yet: simulation not ready.', 'danger');
            if (ui.benchmarkStatusEl) {
                ui.benchmarkStatusEl.textContent = 'Preparing simulation... wait a moment, then try again.';
            }
            return;
        }

        const resolution = `${renderer.domElement.width}x${renderer.domElement.height}`;
        const sceneElements = { composer, accretionDisk, nebulaMaterials };

        // Ensure a concise system summary is available for benchmark logs
        const systemSummary = systemCapabilities.systemSummary || 'Unknown system';

        // Callback used by BenchmarkController to request sim state changes.
        const onBenchmarkStateChange = async (newState) => {
            let localStateChanged = false;

            if (typeof newState.quality === 'string') {
                simState.physicsQuality = newState.quality;
                localStateChanged = true;
            }
            if (typeof newState.particleCount === 'number') {
                simState.particleCount = newState.particleCount;
                localStateChanged = true;
            }
            if (typeof newState.bhMass === 'number') {
                simState.bhMass = newState.bhMass;
                localStateChanged = true;
            }

            if (localStateChanged) {
                stateChanged = true;
            }

            // Promise resolves when worker acknowledges with state_updated.
            return new Promise((resolve) => {
                if (resolveStateUpdate) {
                    try { resolveStateUpdate(); } catch (_) {}
                }
                resolveStateUpdate = resolve;
            });
        };

        benchmarkController.start(
            log,
            logFunc,
            onBenchmarkStateChange,
            sceneElements,
            resolution,
            { ...systemCapabilities, systemSummary }
        );
        ui.benchmarkBtn.textContent = 'Cancel Benchmark';

        // Disable sandbox controls during standardized run
        for (const key in ui.sandboxControls) {
            const ctrl = ui.sandboxControls[key];
            if (ctrl && 'disabled' in ctrl) ctrl.disabled = true;
        }

        ui.benchmarkStatusEl.innerHTML = benchmarkController.getStatus();
    });

    if (ui.sandboxControls.particles) {
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
    }

    // --- BH MASS SLIDER (SANDBOX ONLY, NON-LINEAR MAPPING) ---
    if (ui.sandboxControls.bhMass) {
        // Configure an intuitive UI range.
        // The underlying physics worker will still clamp to its own MIN/MAX;
        // this mapping simply ensures the visible range spans a wide, useful band.
        ui.sandboxControls.bhMass.min = '1';
        ui.sandboxControls.bhMass.max = '10';
        ui.sandboxControls.bhMass.step = '1';

        // Chosen physical mass range for sandbox control.
        // These values sit comfortably within the worker's safe range and
        // provide a clearly noticeable effect across the slider span.
        const MIN_UI_MASS = 2e5;
        const MAX_UI_MASS = 5e7;

        // Helper to map slider value -> physical bhMass exponentially.
        const mapSliderToBhMass = (sliderValue) => {
            const sliderMin = Number(ui.sandboxControls.bhMass.min);
            const sliderMax = Number(ui.sandboxControls.bhMass.max);
            const t = Math.max(0, Math.min(1, (sliderValue - sliderMin) / (sliderMax - sliderMin)));
            return MIN_UI_MASS * Math.pow(MAX_UI_MASS / MIN_UI_MASS, t);
        };

        // Helper to format mass for display (compact/scientific style).
        const formatBhMassLabel = (mass) => {
            if (mass >= 1e7) {
                return (mass / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
            }
            if (mass >= 1e6) {
                return (mass / 1e6).toFixed(2).replace(/0+$/, '').replace(/\.$/, '') + 'M';
            }
            if (mass >= 1e5) {
                return (mass / 1e5).toFixed(1).replace(/\.0$/, '') + 'e5';
            }
            return mass.toExponential(1);
        };

        // Initialize slider position from current simState.bhMass
        // without interfering with benchmark-driven values.
        const sliderMin = Number(ui.sandboxControls.bhMass.min);
        const sliderMax = Number(ui.sandboxControls.bhMass.max);
        const initialBhMass = simState.bhMass || MIN_UI_MASS;
        const clampedInitMass = Math.max(MIN_UI_MASS, Math.min(MAX_UI_MASS, initialBhMass));
        const initialT = Math.log(clampedInitMass / MIN_UI_MASS) / Math.log(MAX_UI_MASS / MIN_UI_MASS);
        const initialSliderValue = sliderMin + initialT * (sliderMax - sliderMin);
        ui.sandboxControls.bhMass.value = String(Math.round(initialSliderValue));

        // Reflect initial mapped mass in simState to align with slider semantics.
        simState.bhMass = mapSliderToBhMass(Number(ui.sandboxControls.bhMass.value));

        // Optional label element: if present in UI, keep it in sync for clarity.
        const bhMassLabelEl = ui.sandboxControls.bhMassLabel || document.getElementById('bh-mass-label');
        if (bhMassLabelEl) {
            bhMassLabelEl.textContent = formatBhMassLabel(simState.bhMass);
        }

        ui.sandboxControls.bhMass.addEventListener('input', (e) => {
            const sliderValue = Number(e.target.value);
            const mappedBhMass = mapSliderToBhMass(sliderValue);

            simState.bhMass = mappedBhMass;
            stateChanged = true;

            if (bhMassLabelEl) {
                bhMassLabelEl.textContent = formatBhMassLabel(mappedBhMass);
            }
        });
    }

    if (ui.sandboxControls.physicsQuality) {
        ui.sandboxControls.physicsQuality.addEventListener('change', (e) => {
            simState.physicsQuality = e.target.value;
            stateChanged = true;
        });
    }
    
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

    if (ui.sandboxControls.resetCameraBtn) {
        ui.sandboxControls.resetCameraBtn.addEventListener('click', () => {
            controls.reset();
            camera.position.set(0, 1000, 2500);
        });
    }

    // Initialize and start the worker
    physicsWorker.postMessage({ type: 'init', maxParticles: MAX_PARTICLES });
}

let bufferReady = false; // Indicates we have a fresh buffer from the worker this frame
let initialBufferReceived = false; // Track if we've received at least one valid buffer

// --- RENDER LOOP ---
function renderLoop() {
    animationFrameId = requestAnimationFrame(renderLoop);
    animate();
}

// --- ANIMATION ---
function animate() {
    // Only block rendering until we have our first valid physics snapshot.
    if (!initialBufferReceived || !dataView) {
        return;
    }

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
    if (ui.metrics.cpuGraph) {
        updatePerfGraph(
            perfHistory.physics,
            stats.physicsCpu.value,
            ui.metrics.cpuGraph,
            '#ff5555',
            {
                label: 'Physics',
                isMs: true,
                legendColor: '#ff5555'
            }
        );
    }
    if (ui.metrics.gpuGraph) {
        updatePerfGraph(
            perfHistory.render,
            stats.renderTime.value,
            ui.metrics.gpuGraph,
            '#00ff88',
            {
                label: 'Render',
                isMs: true,
                legendColor: '#00ff88'
            }
        );
    }

    benchmarkController.update(performance.now());
    if (ui.benchmarkStatusEl) {
        ui.benchmarkStatusEl.innerHTML = benchmarkController.getStatus();
    }
    
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
    // After rendering, hand the buffer back to the worker for the next physics step.
    // This guarantees the buffer is **not** detached until we've finished using it.
    // Only do this when bufferReady is true (i.e., we have just consumed a fresh worker update).
    // ------------------------------------------------------------------
    if (bufferReady && dataView && dataView.buffer && dataView.buffer.byteLength > 0) {
        const message = {
            type: 'physics_update',
            buffer: dataView.buffer
        };

        // Piggy-back any simulation state changes requested by the UI or benchmark controller.
        if (stateChanged) {
            if (ENABLE_VERBOSE_LOGS) {
                console.log(
                    `[main] Sending state changes: ` +
                    `particleCount=${simState.particleCount}, ` +
                    `quality=${simState.physicsQuality}, ` +
                    `bhMass=${simState.bhMass}`
                );
            }
            message.particleCount = simState.particleCount;
            message.quality = simState.physicsQuality;
            message.bhMass = simState.bhMass;
            stateChanged = false;
        }

        stats.physicsCpu.lastTime = performance.now();
        bufferReady = false; // We are about to give the buffer back
        physicsWorker.postMessage(message, [dataView.buffer]);
    }
}

function updatePerfGraph(historyState, value, canvas, color, options = {}) {
    // Defensive guards so any perf-graph issue can never break animation.
    if (!canvas || typeof canvas.getContext !== 'function' || !historyState || !historyState.values) {
        return;
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const w = canvas.width || canvas.clientWidth || 0;
    const h = canvas.height || canvas.clientHeight || 0;
    if (!w || !h) {
        // Nothing to draw yet (e.g. hidden or zero-sized canvas)
        return;
    }

    // Maintain ring buffer in-place to keep perf stable
    const buf = historyState.values;
    const idx = historyState.index;
    buf[idx] = value;
    historyState.index = (idx + 1) % PERF_GRAPH_HISTORY;
    if (historyState.length < PERF_GRAPH_HISTORY) {
        historyState.length++;
    }

    const length = historyState.length;
    if (!Number.isFinite(length) || length < 1) {
        ctx.clearRect(0, 0, w, h);
        return;
    }
    if (length === 1) {
        // With one sample, just record it and wait for more data before drawing lines.
        const v = buf[(idx - 1 + PERF_GRAPH_HISTORY) % PERF_GRAPH_HISTORY];
        if (!Number.isFinite(v)) {
            ctx.clearRect(0, 0, w, h);
        }
        return;
    }

    // Compute instantaneous window min/max over active samples
    let windowMin = buf[0];
    let windowMax = buf[0];
    for (let i = 1; i < length; i++) {
        const v = buf[i];
        if (v < windowMin) windowMin = v;
        if (v > windowMax) windowMax = v;
    }
    if (!Number.isFinite(windowMin) || !Number.isFinite(windowMax)) {
        ctx.clearRect(0, 0, w, h);
        return;
    }

    // Maintain separate smoothed bounds per canvas to avoid cross-talk
    if (!updatePerfGraph._state) {
        updatePerfGraph._state = new WeakMap();
    }
    let smoothed = updatePerfGraph._state.get(canvas);
    if (!smoothed) {
        smoothed = { min: windowMin, max: windowMax };
        updatePerfGraph._state.set(canvas, smoothed);
    }

    const alpha = PERF_GRAPH_SMOOTHING;
    smoothed.min = smoothed.min + (windowMin - smoothed.min) * alpha;
    smoothed.max = smoothed.max + (windowMax - smoothed.max) * alpha;

    // Ensure a small, stable range to avoid division by zero / huge jumps.
    let minVal = smoothed.min;
    let maxVal = smoothed.max * 1.05; // mild headroom
    const epsilon = 0.001;
    if (maxVal - minVal < epsilon) {
        maxVal = minVal + epsilon;
    }

    ctx.clearRect(0, 0, w, h);

    // Draw grid lines
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.lineWidth = 0.5;

    for (let i = 0; i <= 4; i++) {
        const y = (h / 4) * i;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
        ctx.stroke();
    }

    // Draw graph line with longer history and smoother movement
    ctx.beginPath();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;

    const range = maxVal - minVal;
    const lastIndex = (historyState.index - 1 + PERF_GRAPH_HISTORY) % PERF_GRAPH_HISTORY;
    for (let i = 0; i < length; i++) {
        // Oldest sample at x=0, newest at x=w
        const srcIndex = (lastIndex - (length - 1 - i) + PERF_GRAPH_HISTORY) % PERF_GRAPH_HISTORY;
        const v = buf[srcIndex];
        const x = (i / (length - 1 || 1)) * w;
        const normalized = (v - minVal) / range;
        const y = h - normalized * h;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // Lightweight filled area under curve to show trend without noise
    ctx.beginPath();
    ctx.moveTo(0, h);
    for (let i = 0; i < length; i++) {
        const srcIndex = (lastIndex - (length - 1 - i) + PERF_GRAPH_HISTORY) % PERF_GRAPH_HISTORY;
        const v = buf[srcIndex];
        const x = (i / (length - 1 || 1)) * w;
        const normalized = (v - minVal) / range;
        const y = h - normalized * h;
        ctx.lineTo(x, y);
    }
    ctx.lineTo(w, h);
    ctx.closePath();

    const gradient = ctx.createLinearGradient(0, 0, 0, h);
    gradient.addColorStop(0, 'rgba(0, 255, 136, 0.16)');
    gradient.addColorStop(1, 'rgba(0, 255, 136, 0.02)');
    ctx.fillStyle = gradient;
    ctx.fill();

    // Current value marker (still tied to data for the dot only)
    const latestValue = value;
    const latestNorm = (latestValue - minVal) / range;
    const latestY = h - latestNorm * h;

    ctx.beginPath();
    ctx.fillStyle = color;
    ctx.arc(w - 3, latestY, 2.5, 0, Math.PI * 2);
    ctx.fill();

    // Pinned legend and current value text at top of canvas
    const label = options.label || 'Value';
    const isMs = !!options.isMs;
    const unit = isMs ? ' ms' : ' FPS';
    const legendY = 10;

    // Legend strip on the left
    if (label) {
        const legendText = `${label} (${isMs ? 'ms' : 'FPS'})`;
        ctx.save();
        ctx.font = '8px monospace';
        ctx.textAlign = 'left';
        const padding = 3;
        const textWidth = ctx.measureText(legendText).width;
        const boxWidth = textWidth + padding * 3 + 10;
        const boxHeight = 12;

        ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
        ctx.fillRect(2, 2, boxWidth, boxHeight);

        // Color swatch
        ctx.fillStyle = color;
        ctx.fillRect(4, 4, 6, boxHeight - 4);

        // Label text
        ctx.fillStyle = '#ffffff';
        ctx.fillText(legendText, 14, legendY);
        ctx.restore();
    }

    // Pinned current value at top-right
    ctx.save();
    ctx.font = '9px monospace';
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'right';
    ctx.fillText(
        `${latestValue.toFixed(1)}${unit}`,
        w - 4,
        legendY
    );
    ctx.restore();

    // Min/max annotations (smoothed) at fixed positions
    ctx.save();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.65)';
    ctx.font = '7px monospace';
    ctx.textAlign = 'left';
    ctx.fillText(maxVal.toFixed(1), 2, legendY + 9);
    ctx.fillText(minVal.toFixed(1), 2, h - 2);
    ctx.restore();
}

// Reusable vectors to reduce garbage collection
const _tempVector1 = new THREE.Vector3();
const _tempVector2 = new THREE.Vector3();
const _tempSphere = new THREE.Sphere();

function updateParticles(particleCount, elapsedTime) {
    // Safety check for data availability
    if (!dataView || !particleInstances || particleCount > MAX_PARTICLES) {
        if (particleInstances) {
            // Only hard clear when we truly have no valid data.
            particleInstances.count = 0;
            particleInstances.instanceMatrix.needsUpdate = true;
        }
        if (jets && jets.geometry && jets.geometry.attributes.position) {
            jets.geometry.attributes.position.needsUpdate = true;
        }
        return;
    }

    // Handle 0 particle case explicitly
    if (particleCount <= 0) {
        // When worker reports zero particles, reflect that; otherwise we keep last known transforms.
        particleInstances.count = 0;
        particleInstances.instanceMatrix.needsUpdate = true;
        if (jets && jets.geometry && jets.geometry.attributes.position) {
            jets.geometry.attributes.position.needsUpdate = true;
        }
        return;
    }

    // Color tuning: base hue around blue, allow spread into purple/cyan
    const baseHue = 0.62; // between blue and violet
    const hueVariance = 0.18; // wider variance for richer palette

    // Global clamp for how many particles we actually render.
    // Physics may simulate more, but we cap draw calls to reduce overdraw / flicker.
    const RENDER_MAX_PARTICLES = 80000;

    const safeParticleCount = Math.min(particleCount, MAX_PARTICLES);

    // Frustum setup once per frame
    const frustum = new THREE.Frustum();
    const projScreenMatrix = new THREE.Matrix4();
    projScreenMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    frustum.setFromProjectionMatrix(projScreenMatrix);

    // LOD parameters
    const cameraPos = camera.position;
    const maxDistance = 20000;
    const lodDistance1 = 5000;
    const lodDistance2 = 10000;
    const distanceSquared1 = lodDistance1 * lodDistance1;
    const distanceSquared2 = lodDistance2 * lodDistance2;
    const maxDistanceSquared = maxDistance * maxDistance;

    let visibleParticles = 0;
    const maxVisibleParticles = Math.min(
        safeParticleCount,
        Math.min(MAX_VISIBLE_PARTICLES, RENDER_MAX_PARTICLES)
    );

    // Hard cap on per-frame instance updates to avoid CPU spikes; we update
    // the first N visible particles only, keeping transforms for the rest.
    const maxUpdatesThisFrame = MAX_VISIBLE_UPDATES_PER_FRAME;

    for (let i = 0; i < safeParticleCount && visibleParticles < maxVisibleParticles; i++) {
        const offset = i * PARTICLE_STRIDE;

        // Position
        const x = dataView[offset];
        const y = dataView[offset + 1];
        const z = dataView[offset + 2];

        // Skip consumed or uninitialized particles (marked with x > 99998 or NaN)
        if (!Number.isFinite(x) || x > 99998) {
            continue;
        }

        // Quick distance check using squared distance (no sqrt)
        _tempVector1.set(x, y, z);
        const distanceSquared = _tempVector1.distanceToSquared(cameraPos);

        if (distanceSquared > maxDistanceSquared) {
            continue;
        }

        // LOD downsampling
        if (distanceSquared > distanceSquared2) {
            if (i % 5 !== 0) continue; // stronger thinning in far field
        } else if (distanceSquared > distanceSquared1) {
            if (i % 2 !== 0) continue;
        }

        // Frustum culling
        _tempSphere.set(_tempVector1, 10);
        if (!frustum.intersectsSphere(_tempSphere)) {
            continue;
        }

        const baseIndex = visibleParticles * 3;
        visiblePositions[baseIndex] = x;
        visiblePositions[baseIndex + 1] = y;
        visiblePositions[baseIndex + 2] = z;

        // Velocity
        const vx = dataView[offset + 3];
        const vy = dataView[offset + 4];
        const vz = dataView[offset + 5];
        visibleVelocities[baseIndex] = vx;
        visibleVelocities[baseIndex + 1] = vy;
        visibleVelocities[baseIndex + 2] = vz;

        // Color based on speed, radial distance, and vertical height
        const speed = Math.sqrt(vx * vx + vy * vy + vz * vz);
        const radius = Math.sqrt(x * x + z * z);
        const height = Math.abs(y);

        // Per-particle pseudo-random from index to avoid bands
        let hueJitter = ((i * 17) % 37) / 37 - 0.5; // [-0.5, 0.5)
        let hue = baseHue
            + hueJitter * hueVariance                         // random spread
            + (height / 4000) * 0.06;                         // higher -> more purple

        // Fast inner particles lean slightly cyan for energy
        if (radius < 2000 && speed > 30) {
            hue -= 0.05;
        }

        // Clamp into visible blue/purple range
        if (hue < 0.5) hue = 0.5;
        if (hue > 0.8) hue = 0.8;

        // Saturation/lightness tuned for subtle glow, not bloom overload
        let saturation = 0.45 + Math.min(0.4, speed / 400);   // 0.45 - 0.85
        let lightness = 0.22 + Math.min(0.25, speed / 600);   // 0.22 - 0.47

        // Dim farther particles
        if (distanceSquared > distanceSquared2) {
            saturation *= 0.65;
            lightness *= 0.85;
        } else if (distanceSquared > distanceSquared1) {
            saturation *= 0.8;
            lightness *= 0.92;
        }

        _tempColor.setHSL(hue, saturation, lightness);
        visibleColors[baseIndex] = _tempColor.r;
        visibleColors[baseIndex + 1] = _tempColor.g;
        visibleColors[baseIndex + 2] = _tempColor.b;

        visibleParticles++;
    }

    // Update particle instances with batched data.
    if (visibleParticles === 0) {
        // If culling produced no visible particles, keep previous particleInstances state
        // instead of forcing a hard flash to zero, unless the simulation truly has none.
        if (activeParticleCount <= 0) {
            particleInstances.count = 0;
            particleInstances.instanceMatrix.needsUpdate = true;
            if (instanceColorAttribute && instanceVelocityAttribute) {
                instanceColorAttribute.needsUpdate = true;
                instanceVelocityAttribute.needsUpdate = true;
            }
        }
        if (jets && jets.geometry && jets.geometry.attributes.position) {
            jets.geometry.attributes.position.needsUpdate = true;
        }
        return;
    }

    // Limit how many instances we fully update this frame; remaining instances
    // retain their last transforms/attributes to avoid spikes.
    const instancesToUpdate = Math.min(visibleParticles, maxUpdatesThisFrame);

    for (let i = 0; i < instancesToUpdate; i++) {
        const baseIndex = i * 3;
        _tempObject.position.set(
            visiblePositions[baseIndex],
            visiblePositions[baseIndex + 1],
            visiblePositions[baseIndex + 2]
        );
        _tempObject.updateMatrix();
        particleInstances.setMatrixAt(i, _tempObject.matrix);
    }

    // Only adjust particleInstances.count up to visibleParticles; we never
    // shrink below instancesToUpdate in a way that would cause a full flash.
    particleInstances.count = Math.max(particleInstances.count || 0, visibleParticles);
    particleInstances.instanceMatrix.needsUpdate = true;

    // Update instanced attributes without reallocations for the updated subset.
    if (instanceColorAttribute && instanceVelocityAttribute) {
        for (let i = 0; i < instancesToUpdate; i++) {
            const baseIndex = i * 3;
            instanceColorAttribute.setXYZ(
                i,
                visibleColors[baseIndex],
                visibleColors[baseIndex + 1],
                visibleColors[baseIndex + 2]
            );
            instanceVelocityAttribute.setXYZ(
                i,
                visibleVelocities[baseIndex],
                visibleVelocities[baseIndex + 1],
                visibleVelocities[baseIndex + 2]
            );
        }

        instanceColorAttribute.needsUpdate = true;
        instanceVelocityAttribute.needsUpdate = true;
    }

    // Update jets geometry
    if (jets && jets.geometry && jets.geometry.attributes.position) {
        jets.geometry.attributes.position.needsUpdate = true;
    }
}

function updateJets(dt) {
    // Safety: if jets are missing/disposed, skip.
    if (!jets || !jets.geometry || !jets.geometry.attributes.position) return;

    const positions = jets.geometry.attributes.position.array;
    let visibleJetParticles = 0;

    // Hard cap to keep jet update cost predictable.
    const MAX_JET_PARTICLES = Math.min(jetParticles.length, 1500);

    for (let i = 0; i < MAX_JET_PARTICLES; i++) {
        const p = jetParticles[i];
        p.lifetime -= dt;

        if (p.lifetime <= 0) {
            // Respawn particle with bounded velocity to reduce extreme excursions.
            p.lifetime = p.initialLifetime = 2 + Math.random() * 3;
            const y = (Math.random() > 0.5 ? 1 : -1) * 110;
            p.velocity.set(
                (Math.random() - 0.5) * 120,
                (y > 0 ? 1 : -1) * (700 + Math.random() * 500),
                (Math.random() - 0.5) * 120
            );
            const baseIndex = i * 3;
            positions[baseIndex] = 0;
            positions[baseIndex + 1] = y;
            positions[baseIndex + 2] = 0;
        } else {
            // Update position
            const baseIndex = i * 3;
            const currentX = positions[baseIndex];
            const currentY = positions[baseIndex + 1];
            const currentZ = positions[baseIndex + 2];

            positions[baseIndex]     = currentX + p.velocity.x * dt;
            positions[baseIndex + 1] = currentY + p.velocity.y * dt;
            positions[baseIndex + 2] = currentZ + p.velocity.z * dt;
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