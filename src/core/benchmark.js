export const State = { IDLE: 0, MAX_Q_SEARCH: 1, GAUNTLET_GPU: 2, GAUNTLET_CPU: 3, GAUNTLET_COMBINED: 4, COMPLETE: 5 };
const GAUNTLET_STAGE_DURATION = 10000;
const MAX_Q_SEARCH_DURATION = 3000;
const TRIM_PERCENTAGE = 0.15;

const BH_MASS_BASELINE = 400000;
const BH_MASS_GPU = 600000;
const BH_MASS_CPU = 2000000;
const BH_MASS_COMBINED = 1000000;

// Warm-up configuration:
// - Warmup is additive (pre-stage), measurement windows remain unchanged.
// - Kept small to avoid user frustration while giving simulation time to settle.
const WARMUP_DURATION_MS = 1500;

// Maximum per-step particleCount delta when ramping between stages.
// Used only internally during warm-up; external API remains unchanged.
const MAX_PARTICLE_STEP = 20000;

// Minimum number of samples required for a stage to be considered valid.
// This prevents bogus 0 / Infinity scores when the simulation hasn't stabilized.
const MIN_SAMPLES_PER_STAGE = 60;

function calculateTrimmedMean(data) {
    if (data.length < 20) return data.length > 0 ? data.reduce((a, b) => a + b, 0) / data.length : 0;
    const sorted = [...data].sort((a, b) => a - b);
    const trimCount = Math.floor(sorted.length * TRIM_PERCENTAGE);
    const trimmedData = sorted.slice(trimCount, sorted.length - trimCount);
    return trimmedData.reduce((a, b) => a + b, 0) / trimmedData.length;
}

export class BenchmarkController {
    constructor() {
        this.reset();
    }

    reset() {
        this.state = State.IDLE;
        this.stageStartTime = 0;
        this.metrics = { fps: [], gpu: [], cpu: [] };

        // Per-stage sub-phase tracking:
        // warmupActive: ignore samples while true.
        // awaitingSync: true until the benchmark start callback confirms
        //               state_updated + first physics_update with new settings.
        this.warmupActive = false;
        this.awaitingSync = false;

        this.maxQValue = 0;
        this.lastPassedCount = 0;
        this.searchStage = 0;

        // More conservative search increments to avoid pushing unstable particle counts
        // on mid/low hardware while still rewarding strong systems.
        this.searchIncrements = [20000, 8000, 2000];
        
        this.results = {
            gpu: { avgGpuTime: 0 },
            cpu: { avgCpuTime: 0 },
            combined: { avgFps: 0 },
        };
        this.finalScore = 0;

        this.log = null;
        this.logMessage = null;
        this.physicsWorker = null;
        this.sceneElements = null;
        this.currentParticleCount = 0;
        this.onStateChange = () => {}; // Callback for state changes

        // Particle management state
        this.particleResetInProgress = false;
        this.pendingParticleResets = [];
    }

    // Enhanced particle count management with queuing
    async setParticleCount(count) {
        if (this.particleResetInProgress) {
            // Queue the request
            this.pendingParticleResets.push(count);
            return Promise.resolve();
        }

        this.particleResetInProgress = true;

        try {
            const target = Math.max(0, count | 0);
            let current = this.currentParticleCount | 0;

            // Step large transitions during warm-up to avoid visual popping.
            // Uses MAX_PARTICLE_STEP; linear stepping only.
            const applyCount = async (nextCount) => {
                if (this.onStateChange) {
                    await this.onStateChange({
                        quality: this.getCurrentPhysicsQuality(),
                        particleCount: nextCount,
                        bhMass: this.getCurrentBhMass()
                    });
                }
                this.currentParticleCount = nextCount;
            };

            const delta = target - current;
            const stepSign = delta >= 0 ? 1 : -1;
            const stepSize = MAX_PARTICLE_STEP * stepSign;

            // Only ramp if we are in a warmup-capable stage.
            const shouldRamp =
                (this.state === State.MAX_Q_SEARCH ||
                 this.state === State.GAUNTLET_GPU ||
                 this.state === State.GAUNTLET_CPU ||
                 this.state === State.GAUNTLET_COMBINED) &&
                Math.abs(delta) > MAX_PARTICLE_STEP;

            if (!shouldRamp) {
                await applyCount(target);
            } else {
                // Walk in linear steps; each step waits for worker sync via onStateChange promise.
                let next = current;
                while ((stepSign > 0 && next + stepSize < target) ||
                       (stepSign < 0 && next + stepSize > target)) {
                    next += stepSize;
                    await applyCount(next);
                }
                await applyCount(target);
            }
        } finally {
            this.particleResetInProgress = false;

            // Process pending requests
            if (this.pendingParticleResets.length > 0) {
                const nextCount = this.pendingParticleResets.shift();
                return this.setParticleCount(nextCount);
            }
        }
    }
    
    // Get current physics quality based on benchmark state
    getCurrentPhysicsQuality() {
        switch(this.state) {
            case State.MAX_Q_SEARCH: return 'complex';
            case State.GAUNTLET_GPU: return 'simple';
            case State.GAUNTLET_CPU: return 'extreme';
            case State.GAUNTLET_COMBINED: return 'complex';
            default: return 'simple';
        }
    }

    getCurrentBhMass() {
        switch (this.state) {
            case State.MAX_Q_SEARCH:
                return BH_MASS_BASELINE;
            case State.GAUNTLET_GPU:
                return BH_MASS_GPU;
            case State.GAUNTLET_CPU:
                return BH_MASS_CPU;
            case State.GAUNTLET_COMBINED:
                return BH_MASS_COMBINED;
            default:
                return BH_MASS_BASELINE;
        }
    }

    start(log, logMessage, onStateChange, sceneElements, resolution, systemCapabilities) {
        this.reset();
        this.log = log;
        this.logMessage = logMessage;
        this.onStateChange = onStateChange;
        this.sceneElements = sceneElements;

        this.logMessage("Starting Comprehensive Benchmark...", 'warn');
        this.log.start(systemCapabilities, resolution);

        this.runMaxQSearch(0);
    }

    async runMaxQSearch(count = 0) {
        this.state = State.MAX_Q_SEARCH;
        this.logMessage(`[Max-Q Search] Testing ${count} particles...`, 'info');

        this.metrics = { fps: [], gpu: [], cpu: [] };
        this.warmupActive = true;
        this.awaitingSync = true;

        await this.setParticleCount(count);

        // setParticleCount() waits on onStateChange -> state_updated.
        // After that, we are synchronized and can start the warmup timer.
        this.awaitingSync = false;
        this.stageStartTime = performance.now();
    }

    async runGpuTest() {
        this.state = State.GAUNTLET_GPU;
        this.logMessage(`[Gauntlet 1/3] Running GPU Stress Test with ${this.maxQValue} particles...`, 'warn');

        this.sceneElements.composer.enabled = true;
        this.sceneElements.accretionDisk.visible = true;
        this.sceneElements.nebulaMaterials.forEach(m => m.visible = true);

        this.metrics = { fps: [], gpu: [], cpu: [] };
        this.warmupActive = true;
        this.awaitingSync = true;

        await this.setParticleCount(this.maxQValue);
        if (this.onStateChange) {
            await this.onStateChange({
                quality: 'simple',
                particleCount: this.maxQValue,
                bhMass: BH_MASS_GPU
            });
        }

        this.awaitingSync = false;
        this.stageStartTime = performance.now();
    }

    async runCpuTest() {
        this.state = State.GAUNTLET_CPU;
        this.logMessage(`[Gauntlet 2/3] Running CPU Stress Test with ${this.maxQValue} particles...`, 'warn');

        this.sceneElements.composer.enabled = false; // Disable post-processing
        this.sceneElements.accretionDisk.visible = false;
        this.sceneElements.nebulaMaterials.forEach(m => m.visible = false);

        this.metrics = { fps: [], gpu: [], cpu: [] };
        this.warmupActive = true;
        this.awaitingSync = true;

        await this.setParticleCount(this.maxQValue);
        if (this.onStateChange) {
            await this.onStateChange({
                quality: 'extreme',
                particleCount: this.maxQValue,
                bhMass: BH_MASS_CPU
            });
        }

        this.awaitingSync = false;
        this.stageStartTime = performance.now();
    }

    async runCombinedTest() {
        this.state = State.GAUNTLET_COMBINED;
        this.logMessage(`[Gauntlet 3/3] Running Combined Stress Test with ${this.maxQValue} particles...`, 'warn');

        this.sceneElements.composer.enabled = true;
        this.sceneElements.accretionDisk.visible = true;
        this.sceneElements.nebulaMaterials.forEach(m => m.visible = true);

        this.metrics = { fps: [], gpu: [], cpu: [] };
        this.warmupActive = true;
        this.awaitingSync = true;

        await this.setParticleCount(this.maxQValue);
        if (this.onStateChange) {
            await this.onStateChange({
                quality: 'complex',
                particleCount: this.maxQValue,
                bhMass: BH_MASS_COMBINED
            });
        }

        this.awaitingSync = false;
        this.stageStartTime = performance.now();
    }

    update(currentTime) {
        if (this.state === State.IDLE || this.state === State.COMPLETE) return;

        const duration = this.state === State.MAX_Q_SEARCH ? MAX_Q_SEARCH_DURATION : GAUNTLET_STAGE_DURATION;

        // While awaitingSync, do not advance warmup or measurement.
        if (this.awaitingSync) {
            return;
        }

        // Warm-up window: ignore samples until full WARMUP_DURATION_MS has elapsed.
        if (this.warmupActive) {
            if (currentTime - this.stageStartTime >= WARMUP_DURATION_MS) {
                this.warmupActive = false;
                this.stageStartTime = currentTime;
                this.metrics = { fps: [], gpu: [], cpu: [] };
            }
            return;
        }

        if (currentTime - this.stageStartTime >= duration) {
            this.evaluateStage();
        }
    }

    evaluateStage() {
        // Get detailed metrics before evaluating
        const detailedMetrics = this.getDetailedMetrics();

        const hasEnoughSamples = (arr) => Array.isArray(arr) && arr.length >= MIN_SAMPLES_PER_STAGE;
        
        switch(this.state) {
            case State.MAX_Q_SEARCH:
                this.evaluateMaxQSearch();
                break;

            case State.GAUNTLET_GPU:
                if (!hasEnoughSamples(this.metrics.gpu)) {
                    this.logMessage('GPU Test incomplete: insufficient samples. Marking run invalid.', 'danger');
                    this.complete(true);
                    break;
                }
                this.results.gpu.avgGpuTime = calculateTrimmedMean(this.metrics.gpu);
                this.logMessage(`GPU Test Complete. Avg Render Time: ${this.results.gpu.avgGpuTime.toFixed(2)}ms`, 'success');
                
                // Log detailed metrics
                this.log.addStage({
                    name: 'GPU Stress',
                    ...this.results.gpu,
                    particles: this.maxQValue,
                    quality: 'simple',
                    detailedMetrics: {
                        minGpuTime: detailedMetrics.gpu?.min,
                        maxGpuTime: detailedMetrics.gpu?.max,
                        gpuStdDev: detailedMetrics.gpu?.stdDev,
                        minFps: detailedMetrics.fps?.min,
                        maxFps: detailedMetrics.fps?.max,
                        fpsStdDev: detailedMetrics.fps?.stdDev
                    }
                });
                
                this.runCpuTest();
                break;
            case State.GAUNTLET_CPU:
                if (!hasEnoughSamples(this.metrics.cpu)) {
                    this.logMessage('CPU Test incomplete: insufficient samples. Marking run invalid.', 'danger');
                    this.complete(true);
                    break;
                }
                this.results.cpu.avgCpuTime = calculateTrimmedMean(this.metrics.cpu);
                this.logMessage(`CPU Test Complete. Avg Physics Time: ${this.results.cpu.avgCpuTime.toFixed(2)}ms`, 'success');
                
                // Log detailed metrics
                this.log.addStage({
                    name: 'CPU Stress',
                    ...this.results.cpu,
                    particles: this.maxQValue,
                    quality: 'extreme',
                    detailedMetrics: {
                        minCpuTime: detailedMetrics.cpu?.min,
                        maxCpuTime: detailedMetrics.cpu?.max,
                        cpuStdDev: detailedMetrics.cpu?.stdDev,
                        minFps: detailedMetrics.fps?.min,
                        maxFps: detailedMetrics.fps?.max,
                        fpsStdDev: detailedMetrics.fps?.stdDev
                    }
                });
                
                this.runCombinedTest();
                break;
            case State.GAUNTLET_COMBINED:
                if (!hasEnoughSamples(this.metrics.fps)) {
                    this.logMessage('Combined Test incomplete: insufficient samples. Marking run invalid.', 'danger');
                    this.complete(true);
                    break;
                }
                this.results.combined.avgFps = calculateTrimmedMean(this.metrics.fps);
                this.logMessage(`Combined Test Complete. Avg FPS: ${this.results.combined.avgFps.toFixed(1)}`, 'success');
                
                // Log detailed metrics
                this.log.addStage({
                    name: 'Combined',
                    ...this.results.combined,
                    particles: this.maxQValue,
                    quality: 'complex',
                    detailedMetrics: {
                        minFps: detailedMetrics.fps?.min,
                        maxFps: detailedMetrics.fps?.max,
                        fpsStdDev: detailedMetrics.fps?.stdDev,
                        minGpuTime: detailedMetrics.gpu?.min,
                        maxGpuTime: detailedMetrics.gpu?.max,
                        gpuStdDev: detailedMetrics.gpu?.stdDev,
                        minCpuTime: detailedMetrics.cpu?.min,
                        maxCpuTime: detailedMetrics.cpu?.max,
                        cpuStdDev: detailedMetrics.cpu?.stdDev
                    }
                });
                
                this.complete();
                break;
        }
    }

    evaluateMaxQSearch() {
        const stableFps = calculateTrimmedMean(this.metrics.fps);
        const passes = stableFps >= 58;
        this.logMessage(`[Max-Q Search] ${this.currentParticleCount} particles -> ${stableFps.toFixed(1)} FPS. ${passes ? 'PASS' : 'FAIL'}.`, passes ? 'success' : 'danger');
        
        if (passes) {
            this.lastPassedCount = this.currentParticleCount;

            // Cap Max-Q to keep visual/physics stable even on very strong machines.
            const HARD_MAX_Q = 120000;

            if (this.currentParticleCount >= HARD_MAX_Q) {
                this.maxQValue = HARD_MAX_Q;
                this.logMessage(`Max-Q Search Complete. Value: ${this.maxQValue}`, 'success');
                this.runGpuTest();
            } else {
                this.runMaxQSearch(this.currentParticleCount + this.searchIncrements[this.searchStage]);
            }
        } else {
            this.searchStage++;
            if (this.searchStage >= this.searchIncrements.length) {
                this.maxQValue = this.lastPassedCount;
                this.logMessage(`Max-Q Search Complete. Value: ${this.maxQValue}`, 'success');
                this.runGpuTest();
            } else {
                this.logMessage(`[Max-Q Search] Dropping to finer search step (+${this.searchIncrements[this.searchStage]}).`, 'warn');
                this.runMaxQSearch(this.lastPassedCount);
            }
        }
    }

    recordMetrics(fps, gpu, cpu) {
        // Only record during active measurement window:
        // - Not idle/complete
        // - Not during warm-up
        // - Not while awaiting sync after a state change
        if (
            this.state === State.IDLE ||
            this.state === State.COMPLETE ||
            this.warmupActive ||
            this.awaitingSync
        ) {
            return;
        }

        this.metrics.fps.push(fps);
        this.metrics.gpu.push(gpu);
        this.metrics.cpu.push(cpu);
    }
    
    // Get detailed metrics statistics
    getDetailedMetrics() {
        const fpsStats = this.log.calculateMetricsStats(this.metrics.fps);
        const cpuStats = this.log.calculateMetricsStats(this.metrics.cpu);
        const gpuStats = this.log.calculateMetricsStats(this.metrics.gpu);
        
        return {
            fps: fpsStats,
            cpu: cpuStats,
            gpu: gpuStats
        };
    }

    cancel(logMessage) { 
        this.state = State.IDLE; 
        logMessage("Benchmark cancelled by user.", 'danger');
    }

    complete(invalid = false) {
        this.state = State.COMPLETE;

        if (invalid) {
            this.results.finalScore = 0;
            this.logMessage('Benchmark run marked INVALID (insufficient or unstable data).', 'danger');
            this.log && this.log.complete(0, { invalid: true });
        } else {
            const safeGpu = this.results.gpu.avgGpuTime > 0 ? this.results.gpu.avgGpuTime : Infinity;
            const safeCpu = this.results.cpu.avgCpuTime > 0 ? this.results.cpu.avgCpuTime : Infinity;
            const safeFps = this.results.combined.avgFps > 0 ? this.results.combined.avgFps : 0;

            const gpu_score = safeGpu !== Infinity ? (1 / safeGpu) * 50000 : 0;
            const cpu_score = safeCpu !== Infinity ? (1 / safeCpu) * 50000 : 0;
            const combined_score = safeFps * 10;

            this.results.finalScore = Math.round(gpu_score + cpu_score + combined_score);
        }
        
        // Enable download log button if it exists
        const downloadLogBtn = document.getElementById('download-log-btn');
        if (downloadLogBtn) {
            downloadLogBtn.disabled = false;
        }
        
        // Enable submit score button if it exists
        const submitScoreBtn = document.getElementById('submit-score-btn');
        if (submitScoreBtn) {
            submitScoreBtn.disabled = false;
        }

        this.logMessage(`Benchmark Complete! Final Score: ${this.results.finalScore}`, invalid ? 'danger' : 'success');
        if (this.log) {
            this.log.complete(this.results.finalScore);
        }
    }

    getStatus() {
        if (this.state === State.IDLE || this.state === State.COMPLETE) {
            return this.state === State.IDLE ? "Ready for Comprehensive Test." : `Test Complete!<div class="final-score">Final Score: <strong>${this.results.finalScore}</strong></div>`;
        }

        const duration = this.state === State.MAX_Q_SEARCH ? MAX_Q_SEARCH_DURATION : GAUNTLET_STAGE_DURATION;
        const timeLeft = Math.max(0, (duration - (performance.now() - this.stageStartTime)) / 1000).toFixed(1);
        switch(this.state) {
            case State.MAX_Q_SEARCH: return `<b>Calibrating... (1/4)</b><br>Finding Max Particles<br>Time left: ${timeLeft}s`;
            case State.GAUNTLET_GPU: return `<b>GPU Stress Test (2/4)</b><br>${this.maxQValue} Particles<br>Time left: ${timeLeft}s`;
            case State.GAUNTLET_CPU: return `<b>CPU Stress Test (3/4)</b><br>${this.maxQValue} Particles<br>Time left: ${timeLeft}s`;
            case State.GAUNTLET_COMBINED: return `<b>Combined Test (4/4)</b><br>${this.maxQValue} Particles<br>Time left: ${timeLeft}s`;
            default: return "Initializing...";
        }
    }
}