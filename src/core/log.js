export class Log {
    constructor() {
        this.content = "";
        this.events = [];
        this.startTime = null;
        this.endTime = null;
        this.benchmarkStages = [];
        this.detailedMetrics = [];
    }
    
    start(systemCapabilities, resolution) {
        this.startTime = new Date();
        this.content = `NEBULA AUSP BENCHMARK LOG\n`;
        this.content += `========================\n`;
        this.content += `Date: ${this.startTime.toISOString()}\n`;
        this.content += `Version: ${systemCapabilities.version || 'Unknown'}\n`;
        this.content += `User Agent: ${navigator.userAgent}\n`;
        this.content += `Session ID: ${this.generateSessionId()}\n\n`;
        
        this.content += "--- SYSTEM INFO ---\n";
        this.content += `OS: ${systemCapabilities.os}\n`;
        this.content += `Architecture: ${systemCapabilities.architecture || 'Unknown'}\n`;
        this.content += `CPU Cores: ${systemCapabilities.cpuCores}\n`;
        this.content += `Memory: ${systemCapabilities.memory || 'Unknown'} GB\n`;
        this.content += `GPU: ${systemCapabilities.gpuRenderer}\n`;
        this.content += `GPU Vendor: ${systemCapabilities.gpuVendor}\n`;
        this.content += `Browser: ${systemCapabilities.browser} ${systemCapabilities.browserVersion}\n`;
        this.content += `Screen Resolution: ${systemCapabilities.screenResolution}\n`;
        this.content += `Viewport Resolution: ${resolution}\n`;
        this.content += `Device Pixel Ratio: ${systemCapabilities.devicePixelRatio}\n`;
        this.content += `Timezone: ${systemCapabilities.timezone}\n`;
        this.content += `Language: ${systemCapabilities.language}\n\n`;
        
        // Advanced capabilities
        this.content += "--- ADVANCED CAPABILITIES ---\n";
        this.content += `WebAssembly: ${systemCapabilities.hasWasm ? 'Supported' : 'Not Supported'}\n`;
        if (systemCapabilities.hasWasm) {
            this.content += `  SIMD: ${systemCapabilities.hasWasmSIMD ? 'Supported' : 'Not Supported'}\n`;
            this.content += `  Threads: ${systemCapabilities.hasWasmThreads ? 'Supported' : 'Not Supported'}\n`;
        }
        this.content += `WebGPU: ${systemCapabilities.hasWebGpu ? 'Supported' : 'Not Supported'}\n`;
        if (systemCapabilities.hasWebGpu) {
            this.content += `  Ray Tracing: ${systemCapabilities.hasRayTracing ? 'Supported' : 'Not Supported'}\n`;
        }
        this.content += `WebGL Version: ${systemCapabilities.webglVersion || 'Unknown'}\n`;
        this.content += `Online: ${systemCapabilities.online ? 'Yes' : 'No'}\n\n`;
        
        this.content += "--- BENCHMARK CONFIGURATION ---\n";
        this.content += `Trim Percentage: 15%\n`;
        this.content += `Max-Q Search Duration: 3 seconds\n`;
        this.content += `Gauntlet Stage Duration: 10 seconds\n\n`;
        
        this.content += "--- BENCHMARK RESULTS ---\n";
        
        // Log this event
        this.events.push({
            type: 'benchmark_start',
            timestamp: this.startTime,
            systemCapabilities,
            resolution,
            sessionId: this.generateSessionId()
        });
    }
    
    generateSessionId() {
        return 'session_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    }
    
    addStage(stage) {
        this.content += `\n--- Stage: ${stage.name} ---\n`;
        this.content += `  - Particles: ${stage.particles}\n`;
        this.content += `  - Physics Quality: ${stage.quality}\n`;
        if (stage.avgFps) this.content += `  - Avg. FPS: ${stage.avgFps.toFixed(1)}\n`;
        if (stage.avgCpuTime) this.content += `  - Avg. CPU Time: ${stage.avgCpuTime.toFixed(2)}ms\n`;
        if (stage.avgGpuTime) this.content += `  - Avg. GPU Time: ${stage.avgGpuTime.toFixed(2)}ms\n`;
        if (stage.duration) this.content += `  - Duration: ${stage.duration.toFixed(2)}ms\n`;
        
        // Add detailed metrics if available
        if (stage.detailedMetrics) {
            this.content += `  - Min FPS: ${stage.detailedMetrics.minFps?.toFixed(1) || 'N/A'}\n`;
            this.content += `  - Max FPS: ${stage.detailedMetrics.maxFps?.toFixed(1) || 'N/A'}\n`;
            this.content += `  - FPS Std Dev: ${stage.detailedMetrics.fpsStdDev?.toFixed(2) || 'N/A'}\n`;
            this.content += `  - Min CPU Time: ${stage.detailedMetrics.minCpuTime?.toFixed(2) || 'N/A'}ms\n`;
            this.content += `  - Max CPU Time: ${stage.detailedMetrics.maxCpuTime?.toFixed(2) || 'N/A'}ms\n`;
            this.content += `  - CPU Std Dev: ${stage.detailedMetrics.cpuStdDev?.toFixed(2) || 'N/A'}ms\n`;
            this.content += `  - Min GPU Time: ${stage.detailedMetrics.minGpuTime?.toFixed(2) || 'N/A'}ms\n`;
            this.content += `  - Max GPU Time: ${stage.detailedMetrics.maxGpuTime?.toFixed(2) || 'N/A'}ms\n`;
            this.content += `  - GPU Std Dev: ${stage.detailedMetrics.gpuStdDev?.toFixed(2) || 'N/A'}ms\n`;
        }
        
        // Store stage data for analysis
        this.benchmarkStages.push({
            name: stage.name,
            timestamp: new Date(),
            data: stage
        });
        
        // Log this event
        this.events.push({
            type: 'stage_complete',
            timestamp: new Date(),
            stageName: stage.name,
            stageData: stage
        });
    }
    
    // Add detailed metrics collection
    addDetailedMetrics(stageName, metrics) {
        const detailedData = {
            stageName,
            timestamp: new Date(),
            metrics
        };
        
        this.detailedMetrics.push(detailedData);
        
        // Log this event
        this.events.push({
            type: 'detailed_metrics',
            timestamp: new Date(),
            stageName,
            metrics
        });
    }
    
    // Calculate statistics for metrics
    calculateMetricsStats(metricsArray) {
        if (!metricsArray || metricsArray.length === 0) {
            return null;
        }
        
        const stats = {
            min: Math.min(...metricsArray),
            max: Math.max(...metricsArray),
            avg: metricsArray.reduce((a, b) => a + b, 0) / metricsArray.length,
            stdDev: 0
        };
        
        // Calculate standard deviation
        const variance = metricsArray.reduce((sum, value) => {
            return sum + Math.pow(value - stats.avg, 2);
        }, 0) / metricsArray.length;
        
        stats.stdDev = Math.sqrt(variance);
        
        return stats;
    }
    
    addEvent(eventType, data = {}) {
        const timestamp = new Date();
        this.events.push({
            type: eventType,
            timestamp,
            data
        });
        
        // Log significant events to content
        if (eventType === 'error') {
            this.content += `\n--- ERROR ---\n`;
            this.content += `  - Time: ${timestamp.toISOString()}\n`;
            this.content += `  - Type: ${data.type || 'Unknown'}\n`;
            this.content += `  - Message: ${data.message || 'No message'}\n`;
            if (data.stack) this.content += `  - Stack: ${data.stack}\n`;
        } else if (eventType === 'warning') {
            this.content += `\n--- WARNING ---\n`;
            this.content += `  - Time: ${timestamp.toISOString()}\n`;
            this.content += `  - Message: ${data.message || 'No message'}\n`;
        }
    }
    
    complete(score) {
        this.endTime = new Date();
        const duration = this.endTime - this.startTime;
        
        this.content += "\n--- FINAL SCORE ---\n";
        this.content += `${score}\n\n`;
        
        this.content += "--- BENCHMARK SUMMARY ---\n";
        this.content += `Total Duration: ${(duration / 1000).toFixed(2)} seconds\n`;
        this.content += `Completion Time: ${this.endTime.toISOString()}\n`;
        
        // Log this event
        this.events.push({
            type: 'benchmark_complete',
            timestamp: this.endTime,
            score,
            duration
        });
    }
    
    getDuration() {
        if (this.startTime && this.endTime) {
            return this.endTime - this.startTime;
        }
        return 0;
    }
    
    getContent() {
        return this.content;
    }
    
    getEvents() {
        return this.events;
    }
    
    download() {
        const blob = new Blob([this.content], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `nebula-benchmark-${new Date().toISOString().replace(/[:.]/g, '-')}.log`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        
        this.addEvent('log_downloaded');
    }
}