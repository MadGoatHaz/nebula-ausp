export async function detectCapabilities(renderer) {
    const capabilities = {
        cpuCores: 0,
        gpuVendor: 'Unknown',
        gpuRenderer: 'Unknown',
        memory: 0,
        os: 'Unknown',
        browser: 'Unknown',
        hasWebGpu: false,
        hasRayTracing: false,
    };

    // --- Hardware ---
    if (navigator.hardwareConcurrency) {
        capabilities.cpuCores = navigator.hardwareConcurrency;
    }
    if (navigator.deviceMemory) {
        capabilities.memory = navigator.deviceMemory;
    }

    // --- Browser & OS ---
    if (navigator.userAgentData) {
        const ua = await navigator.userAgentData.getHighEntropyValues(['platform', 'platformVersion', 'architecture', 'model', 'uaFullVersion']);
        capabilities.os = `${ua.platform} ${ua.platformVersion}`;
        const brand = ua.brands.find(b => b.brand !== "Not A;Brand");
        if (brand) {
            capabilities.browser = `${brand.brand} ${ua.uaFullVersion}`;
        }
    } else {
        // Fallback to userAgent string parsing
        const ua = navigator.userAgent;
        const osMatch = ua.match(/(Windows NT \d+\.\d+|Mac OS X \d+_\d+_\d+|Android \d+\.\d+|iOS \d+_\d+_\d+|Linux [x_]\d+_\d+)/);
        if (osMatch) capabilities.os = osMatch[0].replace(/_/g, '.');
        const browserMatch = ua.match(/(Chrome|Firefox|Safari|Edge)\/([\d\.]+)/);
        if (browserMatch) capabilities.browser = `${browserMatch[1]} ${browserMatch[2]}`;
    }

    // --- GPU ---
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