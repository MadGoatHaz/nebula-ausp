export async function detectCapabilities(renderer) {
    const capabilities = {
        cpuCores: 0,
        gpuVendor: 'Unknown',
        gpuRenderer: 'Unknown',
        memory: 0,
        os: 'Unknown',
        browser: 'Unknown',
        browserVersion: 'Unknown',
        hasWebGpu: false,
        hasRayTracing: false,
        hasWasm: false,
        hasWasmSIMD: false,
        hasWasmThreads: false,
        screenResolution: 'Unknown',
        colorDepth: 0,
        pixelRatio: 1,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        language: navigator.language || 'Unknown',
        cookiesEnabled: navigator.cookieEnabled,
        online: navigator.onLine,
        connection: 'Unknown',
        devicePixelRatio: window.devicePixelRatio || 1,
    };

    // --- Hardware ---
    if (navigator.hardwareConcurrency) {
        capabilities.cpuCores = navigator.hardwareConcurrency;
    }
    
    // Enhanced CPU feature detection
    try {
        // Detect logical processors and basic CPU features
        capabilities.cpuLogicalCores = navigator.hardwareConcurrency || 'Unknown';
        
        // Detect if hyperthreading/multithreading is likely enabled
        if (navigator.hardwareConcurrency && navigator.deviceMemory) {
            // Rough heuristic: if deviceMemory * 2 >= hardwareConcurrency, likely no hyperthreading
            // This is very approximate and not definitive
            capabilities.cpuHyperthreading = navigator.hardwareConcurrency > (navigator.deviceMemory || 0);
        }
    } catch (e) {
        console.warn("Could not detect enhanced CPU features.", e);
    }
    
    if (navigator.deviceMemory) {
        capabilities.memory = navigator.deviceMemory;
    }
    
    // Enhanced memory information
    if (performance.memory) {
        capabilities.jsHeapSizeLimit = Math.round(performance.memory.jsHeapSizeLimit / 1048576); // MB
        capabilities.totalJSHeapSize = Math.round(performance.memory.totalJSHeapSize / 1048576); // MB
        capabilities.usedJSHeapSize = Math.round(performance.memory.usedJSHeapSize / 1048576); // MB
    }

    // --- Display & Screen Info ---
    if (screen) {
        capabilities.screenResolution = `${screen.width}x${screen.height}`;
        capabilities.colorDepth = screen.colorDepth;
    }
    capabilities.pixelRatio = window.devicePixelRatio || 1;

    // --- Network Info ---
    if (navigator.connection) {
        capabilities.connection = {
            effectiveType: navigator.connection.effectiveType || 'Unknown',
            downlink: navigator.connection.downlink || 0,
            rtt: navigator.connection.rtt || 0,
        };
    }

    // --- Browser & OS ---
    if (navigator.userAgentData) {
        try {
            const ua = await navigator.userAgentData.getHighEntropyValues(['platform', 'platformVersion', 'architecture', 'model', 'uaFullVersion']);
            capabilities.os = `${ua.platform} ${ua.platformVersion}`;
            capabilities.architecture = ua.architecture || 'Unknown';
            capabilities.model = ua.model || 'Unknown';
            
            const brand = ua.brands.find(b => b.brand !== "Not A;Brand");
            if (brand) {
                capabilities.browser = brand.brand;
                capabilities.browserVersion = ua.uaFullVersion;
            }
        } catch (e) {
            console.warn("Could not get high entropy user agent data.", e);
        }
    } else {
        // Fallback to userAgent string parsing
        const ua = navigator.userAgent;
        const osMatch = ua.match(/(Windows NT \d+\.\d+|Mac OS X \d+_\d+_\d+|Android \d+\.\d+|iOS \d+_\d+_\d+|Linux [x_]\d+_\d+)/);
        if (osMatch) capabilities.os = osMatch[0].replace(/_/g, '.');
        const browserMatch = ua.match(/(Chrome|Firefox|Safari|Edge)\/([\d\.]+)/);
        if (browserMatch) {
            capabilities.browser = browserMatch[1];
            capabilities.browserVersion = browserMatch[2];
        }
    }

    // --- WebAssembly Support ---
    capabilities.hasWasm = typeof WebAssembly !== 'undefined';
    if (capabilities.hasWasm) {
        try {
            // Test for SIMD support
            const wasmSIMDTest = new WebAssembly.Module(Uint8Array.from([0, 97, 115, 109, 1, 0, 0, 0, 1, 4, 1, 96, 0, 0, 3, 2, 1, 0, 10, 9, 1, 7, 0, 116, 126, 252, 252, 252, 252, 0, 11]));
            capabilities.hasWasmSIMD = true;
        } catch (e) {
            capabilities.hasWasmSIMD = false;
        }
        
        try {
            // Test for threads support
            const wasmThreadsTest = new WebAssembly.Module(Uint8Array.from([0, 97, 115, 109, 1, 0, 0, 0, 1, 4, 1, 96, 0, 0, 3, 2, 1, 0, 5, 4, 1, 3, 1, 1, 10, 11, 1, 9, 0, 65, 0, 254, 16, 2, 0, 26, 11]));
            capabilities.hasWasmThreads = true;
        } catch (e) {
            capabilities.hasWasmThreads = false;
        }
    }

    // --- GPU ---
    if (navigator.gpu) {
        capabilities.hasWebGpu = true;
        try {
            const adapter = await navigator.gpu.requestAdapter();
            if (adapter) {
                const info = adapter.info;
                capabilities.gpuVendor = info.vendor || 'Unknown';
                capabilities.gpuRenderer = info.architecture || info.description || 'Unknown';
                // Check for ray tracing support - feature name may vary by implementation
                if (adapter.features.has('ray-tracing') ||
                    adapter.features.has('ray-tracing-shader') ||
                    adapter.features.has('ray-query') ||
                    adapter.features.has('ray-tracing-pipeline')) {
                    capabilities.hasRayTracing = true;
                }
                
                // Additional WebGPU features for Phase 3 development
                capabilities.webgpuFeatures = {
                    depthClipControl: adapter.features.has('depth-clip-control'),
                    depth24unormStencil8: adapter.features.has('depth24unorm-stencil8'),
                    depth32floatStencil8: adapter.features.has('depth32float-stencil8'),
                    timestampQuery: adapter.features.has('timestamp-query'),
                    textureCompressionBC: adapter.features.has('texture-compression-bc'),
                    textureCompressionETC2: adapter.features.has('texture-compression-etc2'),
                    textureCompressionASTC: adapter.features.has('texture-compression-astc'),
                    // Advanced features for Phase 3
                    indirectFirstInstance: adapter.features.has('indirect-first-instance'),
                    shaderF16: adapter.features.has('shader-f16'),
                    rg11b10ufloatRenderable: adapter.features.has('rg11b10ufloat-renderable'),
                    // Additional features for comprehensive detection
                    bgra8unormStorage: adapter.features.has('bgra8unorm-storage'),
                    float32Filterable: adapter.features.has('float32-filterable'),
                    clipDistances: adapter.features.has('clip-distances'),
                };
                
                // Performance hints for Phase 3 development
                capabilities.webgpuLimits = {
                    maxTextureDimension1D: adapter.limits.maxTextureDimension1D,
                    maxTextureDimension2D: adapter.limits.maxTextureDimension2D,
                    maxTextureDimension3D: adapter.limits.maxTextureDimension3D,
                    maxTextureArrayLayers: adapter.limits.maxTextureArrayLayers,
                    maxBindGroups: adapter.limits.maxBindGroups,
                    maxBufferSize: adapter.limits.maxBufferSize,
                    maxComputeWorkgroupSizeX: adapter.limits.maxComputeWorkgroupSizeX,
                    maxComputeWorkgroupSizeY: adapter.limits.maxComputeWorkgroupSizeY,
                    maxComputeWorkgroupSizeZ: adapter.limits.maxComputeWorkgroupSizeZ,
                    maxComputeWorkgroupsPerDimension: adapter.limits.maxComputeWorkgroupsPerDimension,
                    maxInterStageShaderComponents: adapter.limits.maxInterStageShaderComponents,
                    maxUniformBufferBindingSize: adapter.limits.maxUniformBufferBindingSize,
                };
                
                // Adapter information for detailed reporting
                capabilities.webgpuAdapterInfo = {
                    name: info.name || 'Unknown',
                    vendor: info.vendor || 'Unknown',
                    architecture: info.architecture || 'Unknown',
                    description: info.description || 'Unknown',
                    driver: info.driver || 'Unknown',
                };
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
            
            // Additional WebGL capabilities
            capabilities.webglVersion = gl.getParameter(gl.VERSION);
            capabilities.webglShadingLanguageVersion = gl.getParameter(gl.SHADING_LANGUAGE_VERSION);
            capabilities.webglVendor = gl.getParameter(gl.VENDOR);
            capabilities.maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE);
            capabilities.maxCubeMapTextureSize = gl.getParameter(gl.MAX_CUBE_MAP_TEXTURE_SIZE);
            
            // Enhanced WebGL capabilities detection
            try {
                capabilities.maxRenderbufferSize = gl.getParameter(gl.MAX_RENDERBUFFER_SIZE);
                capabilities.maxViewportDims = gl.getParameter(gl.MAX_VIEWPORT_DIMS);
                capabilities.redBits = gl.getParameter(gl.RED_BITS);
                capabilities.greenBits = gl.getParameter(gl.GREEN_BITS);
                capabilities.blueBits = gl.getParameter(gl.BLUE_BITS);
                capabilities.alphaBits = gl.getParameter(gl.ALPHA_BITS);
                capabilities.depthBits = gl.getParameter(gl.DEPTH_BITS);
                capabilities.stencilBits = gl.getParameter(gl.STENCIL_BITS);
                
                // Check for common WebGL extensions
                capabilities.webglExtensions = [];
                const commonExtensions = [
                    'OES_texture_float',
                    'OES_texture_half_float',
                    'WEBGL_depth_texture',
                    'EXT_texture_filter_anisotropic',
                    'WEBGL_compressed_texture_s3tc',
                    'WEBGL_compressed_texture_pvrtc',
                    'WEBGL_compressed_texture_etc1',
                    'ANGLE_instanced_arrays',
                    'OES_standard_derivatives',
                    'EXT_blend_minmax',
                    'EXT_frag_depth',
                    'WEBGL_draw_buffers',
                    'EXT_shader_texture_lod'
                ];
                
                commonExtensions.forEach(ext => {
                    if (gl.getExtension(ext)) {
                        capabilities.webglExtensions.push(ext);
                    }
                });
            } catch (e) {
                console.warn("Could not get enhanced WebGL capabilities.", e);
            }
            
            // Check for WebGL 2 features that might be relevant for Phase 3
            if (gl instanceof WebGL2RenderingContext) {
                capabilities.hasWebGL2 = true;
                capabilities.maxVertexTextures = gl.getParameter(gl.MAX_VERTEX_TEXTURE_IMAGE_UNITS);
                capabilities.maxVaryingVectors = gl.getParameter(gl.MAX_VARYING_VECTORS);
                capabilities.maxVertexUniformVectors = gl.getParameter(gl.MAX_VERTEX_UNIFORM_VECTORS);
                capabilities.maxFragmentUniformVectors = gl.getParameter(gl.MAX_FRAGMENT_UNIFORM_VECTORS);
                
                // WebGL 2 specific extensions and capabilities
                try {
                    capabilities.max3DTextureSize = gl.getParameter(gl.MAX_3D_TEXTURE_SIZE);
                    capabilities.maxArrayTextureLayers = gl.getParameter(gl.MAX_ARRAY_TEXTURE_LAYERS);
                    capabilities.maxColorAttachments = gl.getParameter(gl.MAX_COLOR_ATTACHMENTS);
                    capabilities.maxDrawBuffers = gl.getParameter(gl.MAX_DRAW_BUFFERS);
                } catch (e) {
                    console.warn("Could not get WebGL 2 specific capabilities.", e);
                }
            }
        } catch (e) {
            console.warn("Could not get WebGL renderer info.", e);
        }
    }
    
    return capabilities;
}