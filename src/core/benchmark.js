export const State = { IDLE: 0, MAX_Q_SEARCH: 1, GAUNTLET_GPU: 2, GAUNTLET_CPU: 3, GAUNTLET_COMBINED: 4, COMPLETE: 5 };
const STAGE_DURATION = 10000;
const TRIM_PERCENTAGE = 0.15;

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
        
        this.maxQValue = 0;
        this.lastPassedCount = 0;
        this.searchStage = 0;
        this.searchIncrements = [15000, 5000, 1000];
        
        this.results = {
            gpu: { avgGpuTime: 0 },
            cpu: { avgCpuTime: 0 },
            combined: { avgFps: 0 },
            finalScore: 0
        };

        this.log = null;
        this.logMessage = null;
        this.physicsWorker = null;
        this.sceneElements = null;
        this.currentParticleCount = 0;
    }

    async start(log, logMessage, physicsWorker, sceneElements, resolution, renderer) {
        this.reset();
        this.log = log;
        this.logMessage = logMessage;
        this.physicsWorker = physicsWorker;
        this.sceneElements = sceneElements;

        this.logMessage("Starting Comprehensive Benchmark...", 'warn');
        await this.log.start(resolution, renderer);
        
        this.runMaxQSearch();
    }

    runMaxQSearch(count = 0) {
        this.state = State.MAX_Q_SEARCH;
        this.currentParticleCount = count;
        this.logMessage(`[Max-Q Search] Testing ${count} particles...`, 'info');
        
        this.physicsWorker.postMessage({ type: 'reset' });
        this.physicsWorker.postMessage({ type: 'set_quality', quality: 'complex' });
        this.physicsWorker.postMessage({ type: 'set_particles', count });
        
        this.stageStartTime = performance.now();
        this.metrics = { fps: [], gpu: [], cpu: [] };
    }

    runGpuTest() {
        this.state = State.GAUNTLET_GPU;
        this.currentParticleCount = this.maxQValue;
        this.logMessage(`[Gauntlet 1/3] Running GPU Stress Test with ${this.maxQValue} particles...`, 'warn');
        
        this.sceneElements.composer.enabled = true;
        this.sceneElements.accretionDisk.visible = true;
        this.sceneElements.nebulaMaterials.forEach(m => m.visible = true);

        this.physicsWorker.postMessage({ type: 'reset' });
        this.physicsWorker.postMessage({ type: 'set_quality', quality: 'simple' });
        this.physicsWorker.postMessage({ type: 'set_particles', count: this.maxQValue });

        this.stageStartTime = performance.now();
        this.metrics = { fps: [], gpu: [], cpu: [] };
    }

    runCpuTest() {
        this.state = State.GAUNTLET_CPU;
        this.currentParticleCount = this.maxQValue;
        this.logMessage(`[Gauntlet 2/3] Running CPU Stress Test with ${this.maxQValue} particles...`, 'warn');
        
        this.sceneElements.composer.enabled = false; // Disable post-processing
        this.sceneElements.accretionDisk.visible = false;
        this.sceneElements.nebulaMaterials.forEach(m => m.visible = false);

        this.physicsWorker.postMessage({ type: 'reset' });
        this.physicsWorker.postMessage({ type: 'set_quality', quality: 'extreme' });
        this.physicsWorker.postMessage({ type: 'set_particles', count: this.maxQValue });

        this.stageStartTime = performance.now();
        this.metrics = { fps: [], gpu: [], cpu: [] };
    }

    runCombinedTest() {
        this.state = State.GAUNTLET_COMBINED;
        this.currentParticleCount = this.maxQValue;
        this.logMessage(`[Gauntlet 3/3] Running Combined Stress Test with ${this.maxQValue} particles...`, 'warn');
        
        this.sceneElements.composer.enabled = true;
        this.sceneElements.accretionDisk.visible = true;
        this.sceneElements.nebulaMaterials.forEach(m => m.visible = true);

        this.physicsWorker.postMessage({ type: 'reset' });
        this.physicsWorker.postMessage({ type: 'set_quality', quality: 'complex' });
        this.physicsWorker.postMessage({ type: 'set_particles', count: this.maxQValue });

        this.stageStartTime = performance.now();
        this.metrics = { fps: [], gpu: [], cpu: [] };
    }

    update(currentTime) {
        if (this.state === State.IDLE || this.state === State.COMPLETE) return;

        if (currentTime - this.stageStartTime >= STAGE_DURATION) {
            this.evaluateStage();
        }
    }

    evaluateStage() {
        switch(this.state) {
            case State.MAX_Q_SEARCH:
                this.evaluateMaxQSearch();
                break;
            case State.GAUNTLET_GPU:
                this.results.gpu.avgGpuTime = calculateTrimmedMean(this.metrics.gpu);
                this.logMessage(`GPU Test Complete. Avg Render Time: ${this.results.gpu.avgGpuTime.toFixed(2)}ms`, 'success');
                this.runCpuTest();
                break;
            case State.GAUNTLET_CPU:
                this.results.cpu.avgCpuTime = calculateTrimmedMean(this.metrics.cpu);
                this.logMessage(`CPU Test Complete. Avg Physics Time: ${this.results.cpu.avgCpuTime.toFixed(2)}ms`, 'success');
                this.runCombinedTest();
                break;
            case State.GAUNTLET_COMBINED:
                this.results.combined.avgFps = calculateTrimmedMean(this.metrics.fps);
                this.logMessage(`Combined Test Complete. Avg FPS: ${this.results.combined.avgFps.toFixed(1)}`, 'success');
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
            if (this.currentParticleCount >= 150000) {
                this.maxQValue = 150000;
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
        if (this.state !== State.IDLE && this.state !== State.COMPLETE) {
            this.metrics.fps.push(fps);
            this.metrics.gpu.push(gpu);
            this.metrics.cpu.push(cpu);
        }
    }

    cancel(logMessage) { 
        this.state = State.IDLE; 
        logMessage("Benchmark cancelled by user.", 'danger');
    }

    complete() {
        this.state = State.COMPLETE;
        const gpu_score = (1 / this.results.gpu.avgGpuTime) * 50000;
        const cpu_score = (1 / this.results.cpu.avgCpuTime) * 50000;
        const combined_score = this.results.combined.avgFps * 10;
        this.results.finalScore = Math.round(gpu_score + cpu_score + combined_score);

        this.logMessage(`Benchmark Complete! Final Score: ${this.results.finalScore}`, 'success');
        this.log.addStage({name: 'GPU Stress', ...this.results.gpu, particles: this.maxQValue, quality: 'simple'});
        this.log.addStage({name: 'CPU Stress', ...this.results.cpu, particles: this.maxQValue, quality: 'extreme'});
        this.log.addStage({name: 'Combined', ...this.results.combined, particles: this.maxQValue, quality: 'complex'});
        this.log.complete(this.results.finalScore);
    }

    getStatus() {
        const timeLeft = Math.max(0, (STAGE_DURATION - (performance.now() - this.stageStartTime)) / 1000).toFixed(1);
        switch(this.state) {
            case State.IDLE: return "Ready for Comprehensive Test.";
            case State.COMPLETE: return `Test Complete!<div class="final-score">Final Score: <strong>${this.results.finalScore}</strong></div>`;
            case State.MAX_Q_SEARCH: return `<b>Calibrating... (1/4)</b><br>Finding Max Particles<br>Time left: ${timeLeft}s`;
            case State.GAUNTLET_GPU: return `<b>GPU Stress Test (2/4)</b><br>${this.maxQValue} Particles<br>Time left: ${timeLeft}s`;
            case State.GAUNTLET_CPU: return `<b>CPU Stress Test (3/4)</b><br>${this.maxQValue} Particles<br>Time left: ${timeLeft}s`;
            case State.GAUNTLET_COMBINED: return `<b>Combined Test (4/4)</b><br>${this.maxQValue} Particles<br>Time left: ${timeLeft}s`;
            default: return "Initializing...";
        }
    }
}