export class Log {
    constructor() {
        this.content = "";
    }
    start(systemCapabilities, resolution) {
        this.content = `NEBULA AUSP BENCHMARK LOG\n`;
        this.content += `Date: ${new Date().toISOString()}\n\n`;
        this.content += "--- SYSTEM INFO ---\n";
        this.content += `OS: ${systemCapabilities.os}\n`;
        this.content += `CPU Cores: ${systemCapabilities.cpuCores}\n`;
        this.content += `Memory: ${systemCapabilities.memory} GB\n`;
        this.content += `GPU: ${systemCapabilities.gpuRenderer}\n`;
        this.content += `Browser: ${systemCapabilities.browser}\n`;
        this.content += `Resolution: ${resolution}\n\n`;
        this.content += "--- BENCHMARK RESULTS ---\n";
    }
    addStage(stage) {
        this.content += `\n--- Stage: ${stage.name} ---\n`;
        this.content += `  - Particles: ${stage.particles}\n`;
        this.content += `  - Physics Quality: ${stage.quality}\n`;
        if (stage.avgFps) this.content += `  - Avg. FPS: ${stage.avgFps.toFixed(1)}\n`;
        if (stage.avgCpuTime) this.content += `  - Avg. CPU Time: ${stage.avgCpuTime.toFixed(2)}ms\n`;
        if (stage.avgGpuTime) this.content += `  - Avg. GPU Time: ${stage.avgGpuTime.toFixed(2)}ms\n`;
    }
    complete(score) {
        this.content += "\n--- FINAL SCORE ---\n";
        this.content += `${score}\n`;
    }
}