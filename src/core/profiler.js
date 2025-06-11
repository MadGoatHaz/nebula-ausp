export async function detectCapabilities(renderer) {
    const capabilities = {
        cpuCores: 0,
        gpuVendor: 'Unknown',
        gpuRenderer: 'Unknown',
        hasWebGpu: false,
        hasRayTracing: false,
    };

    if (navigator.hardwareConcurrency) {
        capabilities.cpuCores = navigator.hardwareConcurrency;
    }

    if (navigator.gpu) {
        capabilities.hasWebGpu = true;
        try {
            const adapter = await navigator.gpu.requestAdapter();
            if (adapter) {
                const info = await adapter.requestAdapterInfo();
                capabilities.gpuVendor = info.vendor;
                capabilities.gpuRenderer = info.architecture || info.description;
                if (adapter.features.has('ray-tracing')) {
                    capabilities.hasRayTracing = true;
                }
            }
        } catch (e) {
            console.warn("Could not get WebGPU adapter info.", e);
        }
    }

    if (capabilities.gpuRenderer === 'Unknown') {
        try {
            const gl = renderer.getContext();
            const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
            if (debugInfo) {
                capabilities.gpuRenderer = gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL);
                capabilities.gpuVendor = gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL);
            }
        } catch (e) {
            console.warn("Could not get WebGL renderer info.", e);
        }
    }
    
    return capabilities;
}