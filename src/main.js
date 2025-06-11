import './style.css';
import { createUI } from './components/ui.js';
import { createScene } from './components/scene.js';
import { BenchmarkController, State } from './core/benchmark.js';
import { Log } from './core/log.js';
import { detectCapabilities } from './core/profiler.js';
import * as THREE from 'three';

// --- CONSTANTS ---
const MAX_PARTICLES = 150000;
const PARTICLE_STRIDE = 6;
const PARTICLE_DEAD_FLAG = 99998;
const MOON_ORBIT_RADIUS = 1500;
const BENCHMARK_UI_UPDATE_INTERVAL = 500; // ms

// --- INITIALIZATION ---
const ui = createUI();
const { scene, camera, renderer, composer, controls, accretionDisk, diskMaterial, jets, jetParticles, moon, nebulaMaterials } = createScene();
document.body.insertBefore(renderer.domElement, document.getElementById('ui-container'));

// --- STATE ---
let particleInstances = null;
let dataView = null;
let sharedBuffer = null;
let physicsTime = 0;
let consumedParticles = 0;
let systemCapabilities = {};

const physicsWorker = new Worker(new URL('./physics/physics.worker.js', import.meta.url), { type: 'module' });
const benchmarkController = new BenchmarkController();
const log = new Log();

// --- LOGIC ---
function logMessage(message, level = 'info') {
    const now = new Date();
    const timestamp = `[${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}]`;
    const messageEl = document.createElement('div');
    messageEl.className = `log-message ${level}`;
    messageEl.innerHTML = `<span class="timestamp">${timestamp}</span><span class="content">${message}</span>`;
    ui.logPanel.appendChild(messageEl);
    ui.logPanel.scrollTop = ui.logPanel.scrollHeight;
}

function initializeSimulation(initialParticleCount = 0) {
    return new Promise((resolve) => {
        logMessage(`Initializing simulation with ${initialParticleCount} particles...`, "warn");
        if (particleInstances) scene.remove(particleInstances);
        const particleMaterial = new THREE.MeshStandardMaterial({ emissive: 0xffffff, vertexColors: true });
        particleInstances = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(5, 0), particleMaterial, MAX_PARTICLES);
        particleInstances.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        scene.add(particleInstances);

        sharedBuffer = new SharedArrayBuffer(MAX_PARTICLES * PARTICLE_STRIDE * Float32Array.BYTES_PER_ELEMENT);
        dataView = new Float32Array(sharedBuffer);
        
        physicsWorker.onmessage = (e) => {
            if (e.data.type === 'physics_report') {
                physicsTime = e.data.physicsStepTime;
                consumedParticles = e.data.consumedParticles;
            } else if (e.data.type === 'ready') {
                logMessage(`Simulation initialized.`, 'success');
                resolve();
            }
        };

        physicsWorker.postMessage({ type: 'init', sharedBuffer: sharedBuffer, maxParticles: MAX_PARTICLES, blackHoleMass: parseFloat(ui.sandboxControls.bhMass.value) });
        physicsWorker.postMessage({ type: 'set_particles', count: initialParticleCount });
    });
}

// --- EVENT LISTENERS ---
ui.sandboxControls.particles.addEventListener('input', (e) => {
    const count = parseInt(e.target.value);
    ui.sandboxControls.particleCountLabel.textContent = count;
    physicsWorker.postMessage({ type: 'set_particles', count: count });
});
ui.sandboxControls.bhMass.addEventListener('input', (e) => physicsWorker.postMessage({ type: 'set_mass', mass: parseFloat(e.target.value) }));
ui.sandboxControls.physicsQuality.addEventListener('input', (e) => physicsWorker.postMessage({ type: 'set_quality', quality: e.target.value }));
ui.sandboxControls.resetCameraBtn.addEventListener('click', () => {
    controls.reset();
    camera.position.set(0, 400, 1200);
    logMessage("Camera reset to default position.", 'info');
});

const presets = {
    'quiet': { particles: 5000, quality: 'simple', mass: 200000 },
    'active': { particles: 80000, quality: 'simple', mass: 800000 },
    'complex': { particles: 15000, quality: 'complex', mass: 400000 },
    'extreme': { particles: 10000, quality: 'extreme', mass: 600000 }
};

ui.sandboxControls.scenario.addEventListener('change', (e) => {
    const presetKey = e.target.value;
    const preset = presets[presetKey];
    if (!preset) return;

    logMessage(`Loading scenario: '${e.target.options[e.target.selectedIndex].text}'`, 'warn');
    
    ui.sandboxControls.particles.value = preset.particles;
    ui.sandboxControls.particleCountLabel.textContent = preset.particles;
    ui.sandboxControls.physicsQuality.value = preset.quality;
    ui.sandboxControls.bhMass.value = preset.mass;

    physicsWorker.postMessage({ type: 'set_particles', count: preset.particles });
    physicsWorker.postMessage({ type: 'set_quality', quality: preset.quality });
    physicsWorker.postMessage({ type: 'set_mass', mass: preset.mass });
});

ui.benchmarkBtn.addEventListener('click', async () => {
    if (benchmarkController.state === State.IDLE || benchmarkController.state === State.COMPLETE) {
        ui.benchmarkBtn.innerText = "Cancel Benchmark";
        ui.benchmarkBtn.classList.add('cancel-btn');
        ui.downloadLogBtn.disabled = true;
        Object.values(ui.sandboxControls).forEach(el => el.disabled = true);
        
        const resolution = ui.sandboxControls.resolution.value;
        const sceneElements = { composer, accretionDisk, nebulaMaterials };
        
        await benchmarkController.start(log, logMessage, physicsWorker, sceneElements, resolution, renderer);
    } else {
        benchmarkController.cancel(logMessage);
    }
});

ui.downloadLogBtn.addEventListener('click', () => {
    const blob = new Blob([log.content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `benchmark-log-${new Date().toISOString().slice(0,10)}.log`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    logMessage("Benchmark log downloaded.", 'success');
});

setInterval(() => {
    if ((benchmarkController.state === State.IDLE || benchmarkController.state === State.COMPLETE) && ui.benchmarkBtn.classList.contains('cancel-btn')) {
        ui.benchmarkBtn.classList.remove('cancel-btn');
        ui.benchmarkBtn.innerText = "Run Comprehensive Benchmark";
        Object.values(ui.sandboxControls).forEach(el => el.disabled = false);
        if (benchmarkController.state === State.COMPLETE) {
            ui.downloadLogBtn.disabled = false;
            ui.submitScoreBtn.disabled = false;
        }
    }
}, BENCHMARK_UI_UPDATE_INTERVAL);

ui.submitScoreBtn.addEventListener('click', () => {
    const results = benchmarkController.results;
    const scoreSummary = `
        <strong>Final Score:</strong> ${results.finalScore}<br>
        <strong>Avg. FPS (Combined):</strong> ${results.combined.avgFps.toFixed(1)}<br>
        <strong>Avg. GPU Time:</strong> ${results.gpu.avgGpuTime.toFixed(2)}ms<br>
        <strong>Avg. CPU Time:</strong> ${results.cpu.avgCpuTime.toFixed(2)}ms
    `;
    const systemSummary = `
        <strong>OS:</strong> ${systemCapabilities.os}<br>
        <strong>CPU:</strong> ${systemCapabilities.cpuCores} Cores<br>
        <strong>Memory:</strong> ${systemCapabilities.memory} GB<br>
        <strong>GPU:</strong> ${systemCapabilities.gpuRenderer}<br>
        <strong>Browser:</strong> ${systemCapabilities.browser}
    `;
    ui.submissionModal.scoreSummary.innerHTML = scoreSummary;
    ui.submissionModal.systemSummary.innerHTML = systemSummary;
    ui.submissionModal.backdrop.classList.remove('hidden');
});

ui.submissionModal.cancelBtn.addEventListener('click', () => {
    ui.submissionModal.backdrop.classList.add('hidden');
});

ui.submissionModal.submitBtn.addEventListener('click', () => {
    const submissionData = {
        score: benchmarkController.results.finalScore,
        results: benchmarkController.results,
        system: systemCapabilities,
        log: log.content
    };
    console.log("--- SUBMITTING TO LEADERBOARD ---");
    console.log(JSON.stringify(submissionData, null, 2));
    logMessage("Score submitted to console.", 'success');
    ui.submissionModal.backdrop.classList.add('hidden');
});

// --- ANIMATION LOOP ---
const clock = new THREE.Clock();
const dummy = new THREE.Object3D();
const color = new THREE.Color();

function updateParticles(particleCount) {
    if (!particleInstances || !dataView) return;

    particleInstances.count = particleCount;
    for (let i = 0; i < particleCount; i++) {
        const i6 = i * PARTICLE_STRIDE;
        if (dataView[i6] > PARTICLE_DEAD_FLAG) {
            dummy.scale.set(0, 0, 0);
        } else {
            dummy.scale.set(1, 1, 1);
            dummy.position.set(dataView[i6], dataView[i6 + 1], dataView[i6 + 2]);
            const vx = dataView[i6 + 3], vy = dataView[i6 + 4], vz = dataView[i6 + 5];
            const speedSq = vx * vx + vy * vy + vz * vz;
            const colorT = Math.min(1, Math.sqrt(speedSq) / 250);
            color.setHSL(0.1 + colorT * 0.1, 1.0, 0.5 + colorT * 0.4);
            particleInstances.setColorAt(i, color);
        }
        dummy.updateMatrix();
        particleInstances.setMatrixAt(i, dummy.matrix);
    }
    particleInstances.instanceMatrix.needsUpdate = true;
    if (particleInstances.instanceColor) {
        particleInstances.instanceColor.needsUpdate = true;
    }
}

function updateJets(dt) {
    const jetPositions = jets.geometry.attributes.position.array;
    for (let i = 0; i < jetParticles.length; i++) {
        const p = jetParticles[i];
        p.lifetime -= dt;
        if (p.lifetime <= 0) {
            const direction = i < jetParticles.length / 2 ? 1 : -1;
            p.velocity.set((Math.random() - 0.5) * 50, direction * (600 + Math.random() * 400), (Math.random() - 0.5) * 50);
            p.lifetime = p.initialLifetime = Math.random() * 2 + 1;
            jetPositions[i * 3] = 0;
            jetPositions[i * 3 + 1] = 0;
            jetPositions[i * 3 + 2] = 0;
        }
        jetPositions[i * 3] += p.velocity.x * dt;
        jetPositions[i * 3 + 1] += p.velocity.y * dt;
        jetPositions[i * 3 + 2] += p.velocity.z * dt;
    }
    jets.geometry.attributes.position.needsUpdate = true;
}

function updateCamera(elapsedTime) {
    if (benchmarkController.state === State.IDLE) {
        controls.update();
    } else {
        camera.position.x = Math.sin(elapsedTime * 0.05) * 1200;
        camera.position.z = Math.cos(elapsedTime * 0.05) * 1200;
        camera.position.y = 600 + Math.sin(elapsedTime * 0.07) * 200;
        camera.lookAt(scene.position);
    }
}

function updateUI(dt, renderTime) {
    benchmarkController.recordMetrics(1 / dt, renderTime, physicsTime);
    benchmarkController.update(performance.now());
    ui.benchmarkStatusEl.innerHTML = benchmarkController.getStatus();

    ui.metrics.fps.textContent = (1 / dt).toFixed(1);
    ui.metrics.renderTime.textContent = renderTime.toFixed(2);
    ui.metrics.physicsCpu.textContent = physicsTime.toFixed(2);
    ui.metrics.consumed.textContent = consumedParticles;
}

function animate() {
    requestAnimationFrame(animate);
    const dt = clock.getDelta();
    const elapsedTime = clock.getElapsedTime();

    const particleCount = (benchmarkController.state === State.IDLE)
        ? parseInt(ui.sandboxControls.particles.value)
        : benchmarkController.currentParticleCount;
    
    diskMaterial.uniforms.uTime.value = elapsedTime;
    nebulaMaterials.forEach(m => m.uniforms.uTime.value = elapsedTime);

    moon.position.set(
        Math.cos(elapsedTime * 0.3) * MOON_ORBIT_RADIUS, 0, 
        Math.sin(elapsedTime * 0.3) * MOON_ORBIT_RADIUS
    );
    physicsWorker.postMessage({ type: 'update_moon', x: moon.position.x, y: moon.position.y, z: moon.position.z });

    updateParticles(particleCount);
    updateJets(dt);
    updateCamera(elapsedTime);
    
    const renderStartTime = performance.now();
    if (composer.enabled) {
        composer.render();
    } else {
        renderer.render(scene, camera);
    }
    const renderTime = performance.now() - renderStartTime;

    updateUI(dt, renderTime);
}

// --- INITIAL SETUP ---
async function main() {
    logMessage("Application starting...", "info");
    
    logMessage("Detecting system capabilities...", "warn");
    systemCapabilities = await detectCapabilities(renderer);
    logMessage("--- System Report ---", "info");
    logMessage(`OS: ${systemCapabilities.os}`, "info");
    logMessage(`Browser: ${systemCapabilities.browser}`, "info");
    logMessage(`CPU Cores: ${systemCapabilities.cpuCores}`, "info");
    logMessage(`Memory: ${systemCapabilities.memory} GB`, "info");
    logMessage(`GPU Vendor: ${systemCapabilities.gpuVendor}`, "info");
    logMessage(`GPU Renderer: ${systemCapabilities.gpuRenderer}`, "info");
    logMessage(`WebGPU Support: ${systemCapabilities.hasWebGpu}`, systemCapabilities.hasWebGpu ? 'success' : 'info');
    logMessage(`Ray Tracing Support: ${systemCapabilities.hasRayTracing}`, systemCapabilities.hasRayTracing ? 'success' : 'info');
    logMessage("---------------------", "info");

    await initializeSimulation(parseInt(ui.sandboxControls.particles.value, 10));
    camera.position.set(0, 400, 1200);
    camera.lookAt(scene.position);
    animate();
}

main();