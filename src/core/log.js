export class Log {
    constructor() {
        this.content = "";
    }
    async start(resolution, renderer) {
        this.content = `3D PROFILER BENCHMARK LOG (v86)\n`;
        this.content += `Date: ${new Date().toISOString()}\n\n`;
        this.content += "--- SYSTEM INFO ---\n";
        if (navigator.gpu) {
            try {
                const adapter = await navigator.gpu.requestAdapter();
                if(adapter) {
                    const info = await adapter.requestAdapterInfo();
                    this.content += `GPU: ${info.description || 'Unknown'}\n`;
                }
            } catch(e) { /* ignore */ }
        }
        if (!this.content.includes("GPU:")) {
            try {
               this.content += `GPU: ${renderer.getContext().getParameter(renderer.getContext().getExtension('WEBGL_debug_renderer_info').UNMASKED_RENDERER_WEBGL)}\n`;
            } catch(e) { this.content += 'GPU: Not Available\n'; }
        }
        this.content += `User Agent: ${navigator.userAgent}\n`;
        this.content += `Resolution: ${resolution}\n\n`;
        this.content += "--- BENCHMARK SETTINGS ---\n";
        this.content += "Target: 60 FPS\n\n";
        this.content += "--- GAUNTLET LOG ---\n";
    }
    addStage(stage) {
        this.content += `\n--- Stage: ${stage.name} ---\n`;
        this.content += `  Avg FPS: ${stage.avgFps.toFixed(1)}\n`;
        this.content += `  Avg Physics CPU: ${stage.avgCpu.toFixed(2)}ms\n`;
        this.content += `  Avg Render Time: ${stage.avgGpu.toFixed(2)}ms\n`;
        this.content += `  Settings: ${stage.particles} particles, ${stage.quality} physics\n`;
    }
    complete(score) {
        this.content += "\n--- FINAL RESULT ---\n";
        this.content += `Overall Score: ${score}\n`;
    }
}