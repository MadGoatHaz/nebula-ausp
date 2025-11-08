# Project Nebula: Definitive Handoff & Developer's Guide
**Version:** Nebula AUSP v0.9.21-alpha (Current Alpha Snapshot)
**Status:** Phase 1 Complete. Phase 2 In Progress. v0.9.21-alpha consolidates performance work, benchmark refinements, and diagnostics/UI improvements.

## 1. Executive Summary

This document is the canonical source of truth for the **Nebula Adaptive Universal System Profiler (AUSP)**. It serves as a master guide for all current and future development. Its purpose is to provide a complete overview of the project's vision, architecture, and history, including a detailed analysis of past failures to ensure they are not repeated.

The project is currently in a **stable, fully functional, and feature-complete** state as defined by the goals of Phase 1. The application successfully runs, provides a comprehensive multi-stage benchmark, and is built on a modern, modular codebase.

## 2. The Prime Directive & Workflow

This section outlines the inviolable rules of our collaboration, previously captured in `AI_COLLABORATION_WORKFLOW.md`.

*   **Rule 1: Stability First.** The primary goal is always a working application. No change will be delivered if it breaks the core functionality of the last stable version. A partially working feature is a complete failure.

*   **Rule 2: The Handoff Protocol.** The Director (human) provides high-level directives. The Implementer (AI) executes them. All work is delivered in a single handoff document containing a summary, the full contents of all modified files, and explicit CLI commands.

*   **Rule 3: The "Full File" Mandate.** The AI will **never** provide partial code or diffs. To minimize human error, all changes to a file will be delivered as the complete, final version of that file.

*   **Rule 4: The Development Environment.** The project uses **Vite.js** as its build tool and development server. All dependencies are managed with **npm**. All code is written in modular JavaScript.

## 3. Project Architecture

The application is built on a modular Vite.js framework. This structure separates concerns and allows for efficient, targeted development.


```
/nebula-ausp/
├── /src/
│ ├── /components/
│ │ ├── ui.js # Creates and returns all UI DOM elements. No event logic.
│ │ ├── scene.js # Creates and returns all THREE.js objects (scene, camera, meshes, composer).
│ │ ├── FilmShader.js # Custom shader for film grain effect.
│ │ └── VignetteShader.js # Custom shader for vignette effect.
│ ├── /core/
│ │ ├── benchmark.js # The "BenchmarkController" state machine. The brain of the benchmark.
│ │ ├── log.js # Class for generating the downloadable benchmark log file.
│ │ └── profiler.js # The "SystemProfiler" for hardware capability detection.
│ ├── /physics/
│ │ └── physics.worker.js # The self-contained physics engine. Runs in a separate thread.
│ ├── main.js # The main entry point. Initializes all modules and connects them with event listeners.
│ └── style.css # All application styles.
├── /public/ # Static assets that are copied directly to the build output.
│ ├── NebulaLogo.png # Project logo.
│ └── screenshot.png # Project screenshot for README.
├── /.github/workflows/ # GitHub Actions workflows.
│ └── deploy.yml # Workflow for deploying to GitHub Pages.
├── .gitignore # Specifies files and folders for Git to ignore.
├── index.html # The main HTML shell.
├── leaderboard.html # The leaderboard page.
├── package.json # Project dependencies and scripts.
├── README.md # Project overview and quick start guide.
├── PROJECT_NEBULA_GUIDE.md # This document.
├── RUST_SETUP.md # Guide for setting up the Rust development environment for Phase 3.
├── AI_COLLABORATION_WORKFLOW.md # Rules for AI collaboration.
├── server.js # Simple Express server for the leaderboard.
└── vite.config.js # Vite configuration.
```

## 4. Core Systems Explained

### 4.1. The Rendering Pipeline
- The renderer is built with **Three.js**.
- To ensure maximum stability across different hardware, the post-processing pipeline is simple and robust: `RenderPass` -> `UnrealBloomPass` -> `FilmPass` -> `VignettePass`.
- **DO:** Add new visual effects as `ShaderPass` or other standard passes *between* the `RenderPass` and the `UnrealBloomPass`.
- **DO NOT:** Manually call `renderer.clear()` when using an `EffectComposer`. The composer manages the clear state itself.
- **DO NOT:** Use unconventional feedback loops or multi-pass rendering unless absolutely necessary and thoroughly tested, as this was a major source of past failures.

### 4.2. The Physics Engine
- The entire physics simulation runs in a **Web Worker** to prevent the main render thread from freezing during heavy calculations.
- Communication between `main.js` and the worker is handled via `postMessage`.
- A `SharedArrayBuffer` is used to give both threads simultaneous access to particle position and velocity data, which is extremely efficient.
- The worker has three quality modes: `simple` (BH-only), `complex` (N-Body), and `extreme` (N-Body with collision detection).

### 4.3. The Benchmark Controller
- The benchmark is managed by the `BenchmarkController` state machine (`src/core/benchmark.js`).
- It follows a strict sequence:
    1.  **Max-Q Search:** Finds the maximum particle count the system can handle at ~60 FPS.
    2.  **Gauntlet - GPU Test:** Runs at the `Max-Q` value with simple physics and all visuals enabled to isolate GPU performance.
    3.  **Gauntlet - CPU Test:** Runs at the `Max-Q` value with extreme physics and all visuals *disabled* to isolate CPU performance.
    4.  **Gauntlet - Combined Test:** Runs at the `Max-Q` value with complex physics and all visuals enabled to measure realistic performance.
    5.  **Scoring:** Calculates a final score based on the results of the three Gauntlet tests.

## 5. The "Book of Failures": A Post-Mortem Analysis

To prevent repeating history, we document our critical failures and the lessons learned.

*   **Case File #A: The `dataVew` Typo**
    *   **Symptom:** Black screen on any version with > 0 particles on startup.
    *   **Root Cause:** A single-character typo (`dataVew` instead of `dataView`) in the particle rendering loop caused a fatal `ReferenceError` on the first frame.
    *   **Lesson:** Scrutinize all code, especially when integrating from a reference. A simple typo can be the most devastating bug.

*   **Case File #B: The `instanceColor` Crash**
    *   **Symptom:** Black screen, silent failure in the `animate` loop.
    *   **Root Cause:** Accessing `.needsUpdate` on `particleInstances.instanceColor` when `instanceColor` was `null` on some hardware.
    *   **Lesson:** Always perform a null check (`if (particleInstances.instanceColor)`) before accessing properties of optional or hardware-dependent objects.

*   **Case File #C: The Dependency Injection Failure**
    *   **Symptom:** The benchmark button would toggle and immediately revert; the benchmark would not run.
    *   **Root Cause:** The `BenchmarkController`'s `start` method received the `physicsWorker` dependency but failed to assign it to `this.physicsWorker`. Internal methods then tried to call `.postMessage` on `null`.
    *   **Lesson:** When using classes, ensure all necessary dependencies are assigned to class properties in the constructor or an initialization method so they are available to all other methods in the class.

*   **Case File #D: The DOM Rendering Race Condition**
    *   **Symptom:** Black screen, but log messages indicated a full, successful initialization.
    *   **Root Cause:** The `main.js` script was appending the renderer's canvas to a `div` (`#app`) instead of the `document.body`. The UI's CSS would then cause the canvas to have a size of `0x0`, crashing the WebGL context.
    *   **Lesson:** The main 3D canvas should almost always be a direct child of `document.body` to ensure it correctly fills the viewport. The UI should be in a separate container that floats on top.

*   **Case File #E: The `SharedArrayBuffer` GitHub Pages Failure**
    *   **Symptom:** Application worked perfectly on the local dev server but showed a black screen and failed to initialize when deployed to GitHub Pages.
    *   **Root Cause:** `SharedArrayBuffer` requires specific `COOP`/`COEP` security headers to function. GitHub Pages does not serve these headers and does not allow them to be configured.
    *   **Lesson:** GitHub Pages is a simple static host. For features requiring specific server headers, a different hosting provider or a non-`SharedArrayBuffer` approach is needed.

*   **Case File #F: The Vite Worker Build Failure**
    *   **Symptom:** The 3D animation would not play on the live GitHub Pages deployment, though it worked locally. The browser console showed the main script was waiting for a message from the physics worker that never arrived.
    *   **Root Cause:** A series of incorrect attempts to bundle the web worker for production. Manual path construction and placing the worker in the `/public` directory led to a state where the browser was either looking for the worker in the wrong place or loading a stale, incorrect version.
    *   **Lesson:** Stick to the standards. The Vite build system is designed to handle web workers correctly out of the box. The definitive solution was to revert all workarounds and use the standard, modern `new Worker(new URL('./path/to/worker.js', import.meta.url))` syntax. This allows Vite to correctly resolve and bundle the worker for any environment.

*   **Case File #G: The Benchmark Synchronization Failure**
    *   **Symptom:** Benchmark always reported "Infinity" as the final score and showed 0 particles in all tests.
    *   **Root Cause:** The benchmark controller was not waiting for the physics worker to confirm it had updated the simulation state before proceeding with measurements. This race condition caused the benchmark to measure an empty scene.
    *   **Lesson:** When dealing with asynchronous operations, especially across threads, always implement a confirmation mechanism to ensure operations are completed before proceeding with dependent tasks.

## 6. Current State & Future Roadmap (Updated, v0.21.x+)

### Phase 1: Foundation & Core Benchmark
*   **Status:** ✅ **Complete (Stabilized)**
*   **Objective:** Deliver a robust, modern architecture and a stable multi-stage benchmark "gauntlet."
*   **Key Results (as implemented):**
    - [x] Vite-based multi-page app with modular JS.
    - [x] Three.js scene + post-processing tuned for stability.
    - [x] Web Worker-based physics engine with:
          - Shared buffer design,
          - Bounded timestep,
          - O(N) core integrators and capped neighbor sampling.
    - [x] Adaptive Max-Q search with:
          - Trimmed-mean FPS evaluation,
          - Minimum sample requirements,
          - A hard Max-Q cap to avoid pathological particle counts.
    - [x] Gauntlet stages (GPU / CPU / Combined) wired with safe scoring:
          - No silent Infinity/NaN,
          - Invalid runs explicitly marked.
    - [x] Visual stability and performance improvements:
          - Volumetric nebula distribution (no flat disc),
          - Subtle continuous motion,
          - Controlled instanced rendering (RENDER_MAX_PARTICLES clamp),
          - Capped and safe jet particles.

### Phase 2: Leaderboard & Community
*   **Status:** 🔳 **In Progress (Foundations Implemented)**
*   **Objective:** Turn Nebula AUSP into a community benchmark with persistent, queryable scores.

*Implemented so far:*
- [x] Local leaderboard backend:
  - [server.js](nebula-ausp/server.js:1) + [src/core/database.js](nebula-ausp/src/core/database.js:1)
  - Express + SQLite with:
    - Scores table (name, score, GPU, CPU cores, OS, etc.).
    - Endpoints:
      - GET /leaderboard (top-N with ranks),
      - POST /leaderboard (validated insert),
      - Additional filtered/stat endpoints ready.
- [x] Frontend integration:
  - Submission flow in [src/main.js](nebula-ausp/src/main.js:436) posts real scores to the backend.
  - [src/leaderboard.js](nebula-ausp/src/leaderboard.js:1) renders leaderboard from live JSON (flat schema).
- [x] Unified dev workflow:
  - [package.json](nebula-ausp/package.json:7):
    - `npm run dev:full` starts Vite + API together via `concurrently`.

*Next-step priorities for Phase 2:*
- [ ] Harden the public API:
  - Enforce stricter input validation and sane score ranges.
  - Add simple abuse protection (rate-limiting, basic signatures or nonces).
- [ ] Pagination & “full leaderboard” UX:
  - Support `?limit` / `?page` on GET /leaderboard.
  - Update leaderboard.html to show top-N with paging / filters (GPU, CPU cores, OS).
- [ ] Deployment-ready backend:
  - Abstract API base URL so frontend can target:
    - Local Express during dev,
    - Cloud/serverless deployment in production (Cloudflare Workers, Fly, etc.).
- [ ] Enhanced system metadata:
  - Use existing profiler output to optionally attach richer, privacy-safe system info per score.

### Phase 3: Advanced Testing (Planned)

*   **Status:** 🔲 **Design Locked, Implementation Pending**
*   **Objective:** Add cutting-edge tests that reward modern hardware without compromising stability.

*Planned tracks:*
- [ ] WASM/SIMD Physics:
  - Rust/C++ module compiled to WebAssembly.
  - Single-threaded, SIMD-accelerated microbenchmark.
  - Integrated as an optional gauntlet stage when capabilities allow.
- [ ] WebGPU Compute N-Body:
  - Mirror or extend the JS worker physics in a pure GPU compute pipeline.
  - Massive-particle test gated on WebGPU support.
- [ ] WebGPU Ray Tracing / RT-path:
  - Optional cinematic scene used only when RT-capable hardware is detected.
  - Never breaks baseline; strictly additive.

All Phase 3 features MUST:
- Respect the collaboration rules:
  - Stability first, no regressions to core benchmark.
  - Capability-gated; never run on unsupported hardware.
- Plug into the existing BenchmarkController without ad-hoc hacks.

## 7. Local Development

1.  **Clone the repository:** `git clone https://github.com/MadGoatHaz/nebula-ausp.git`
2.  **Navigate to directory:** `cd nebula-ausp`
3.  **Install dependencies:** `npm install`
4.  **Run the dev server:** `npm run dev`
5.  Open the provided URL (e.g., `http://localhost:5173`) in your browser.

## Key Learnings & Technical Resolutions

1.  **GitHub Pages and Web Workers:** The most significant recent challenge was ensuring the `physics.worker.js` file was correctly bundled and loaded on the live GitHub Pages deployment.
    *   **Resolution:** After several failed workarounds, the solution was to use the standard ES module syntax for web workers: `new Worker(new URL('./path/to/worker.js', import.meta.url))`. This delegates the entire bundling and path resolution process to Vite, which handles it correctly for both `npm run dev` and `npm run build`. Manual pathing or using the `/public` directory should be avoided as it can lead to hard-to-debug inconsistencies between environments.

2.  **Vite Multi-Page Builds:** Vite's default configuration only builds a single `index.html`.
    -   **Resolution:** The `vite.config.js` was modified to include multiple entry points under `build.rollupOptions.input`, allowing Vite to correctly build both `index.html` and `leaderboard.html`.

3.  **Worker Initialization Race Condition:** The main thread's animation loop was initially starting before the physics worker had sent its first data packet, causing rendering to fail.
    -   **Resolution:** The animation loop (`requestAnimationFrame`) is now only started *after* the first `physics_update` message is received from the worker, ensuring data is available to render.

4.  **Particle Rendering & Performance:**
    -   The particle slider was unresponsive because the main thread and worker had different ideas about the authoritative particle count. The main thread now only renders the number of particles present in the data buffer received from the worker.
    -   The initial particle material was swapped for a `ShaderMaterial` to implement custom effects like motion blur (stretching particles based on velocity) and making them brighter to better interact with the bloom post-processing effect.

5.  **Benchmark Synchronization:**
    -   The benchmark was failing because it wasn't waiting for the physics worker to confirm state changes before proceeding with measurements. This was fixed by implementing a Promise-based system that pauses the benchmark until the worker confirms the simulation state has been updated.

## Future Work & Next Steps

-   **Leaderboard Backend:** The next major step for Phase 2 is to replace the mock JSON data with a real backend service (e.g., using Firebase, Supabase, or a custom Node.js server) to create a persistent, global leaderboard.
-   **Celestial Events:** Introduce scripted or random events, such as a star passing too close to the black hole and being torn apart, creating a spectacular visual showcase.
-   **Code Refinements:** Continue to refactor and optimize the codebase, particularly in the post-processing chain and particle rendering systems.
-   **Sound Design:** Add ambient sound effects and music to enhance the atmosphere.
-   **WASM Physics:** Begin exploration of WebAssembly-based physics simulation for Phase 3, following the guidelines in `RUST_SETUP.md`.

## Critical Bug Fix: Particle Rendering Issue (July 2025)

### Problem Description
In July 2025, a critical bug was discovered where the main physics particles (star particles) were not rendering correctly, although jet particles and other visual elements were working properly. This issue was traced to improper handling of instanced buffer attributes in the particle rendering system.

### Root Cause Analysis
The issue was located in the `updateParticles` function in `src/main.js` (lines 999-1008). The original code attempted to update instanced attributes by replacing entire buffer arrays:

```javascript
// PROBLEMATIC CODE (Lines 999-1008 in src/main.js)
// Update attributes directly for better performance
if (instanceColorAttribute && instanceVelocityAttribute) {
    // Truncate arrays to actual visible particle count
    const visibleColors = new Float32Array(colors.buffer, 0, visibleParticles * 3);
    const visibleVelocities = new Float32Array(velocities.buffer, 0, visibleParticles * 3);
    
    instanceColorAttribute.setArray(visibleColors);
    instanceVelocityAttribute.setArray(visibleVelocities);
    instanceColorAttribute.needsUpdate = true;
    instanceVelocityAttribute.needsUpdate = true;
}
```

The problem with this approach was that the instanced buffer attributes were originally created with fixed-size buffers to accommodate the maximum number of particles (`MAX_PARTICLES = 500000`). When `setArray()` was called to replace these buffers with smaller arrays, it caused rendering issues because:

1. **Buffer Size Mismatch**: The new arrays were much smaller than the original fixed-size buffers
2. **Memory Management**: Replacing the entire buffer array disrupted the WebGL buffer management
3. **Attribute Binding**: The instanced attributes lost their proper binding to the mesh geometry

### Solution Implementation
The fix involved properly updating the existing attribute buffers using the `setXYZ` methods instead of replacing entire arrays:

```javascript
// FIXED CODE (Lines 999-1008 in src/main.js)
// Update attributes directly for better performance
if (instanceColorAttribute && instanceVelocityAttribute) {
    // Update color attributes
    for (let i = 0; i < visibleParticles; i++) {
        const colorOffset = i * 3;
        instanceColorAttribute.setXYZ(
            i, 
            colors[colorOffset], 
            colors[colorOffset + 1], 
            colors[colorOffset + 2]
        );
    }
    
    // Update velocity attributes
    for (let i = 0; i < visibleParticles; i++) {
        const velocityOffset = i * 3;
        instanceVelocityAttribute.setXYZ(
            i, 
            velocities[velocityOffset], 
            velocities[velocityOffset + 1], 
            velocities[velocityOffset + 2]
        );
    }
    
    // Mark attributes as needing update
    instanceColorAttribute.needsUpdate = true;
    instanceVelocityAttribute.needsUpdate = true;
}
```

### Key Changes and Benefits
1. **Proper Attribute Updates**: Using `setXYZ()` methods to update individual attribute components
2. **Preserved Buffer Integrity**: Maintaining the original fixed-size buffer structure
3. **Efficient Memory Usage**: Avoiding unnecessary buffer reallocation
4. **Consistent Rendering**: Ensuring proper WebGL buffer binding and rendering

### Testing and Verification
After implementing this fix:
- Main physics particles (star particles) now render correctly
- Particles load immediately on application startup
- Jet particles continue to work correctly
- All visual elements display as expected
- Performance remains optimal

### Lessons Learned
1. **Buffer Management**: When working with instanced attributes in Three.js, it's crucial to maintain the original buffer structure rather than replacing entire arrays
2. **Debugging Approach**: Adding comprehensive logging helped identify the buffer transfer issues between main thread and worker
3. **Performance Considerations**: The `setXYZ` approach is actually more efficient than buffer replacement for partial updates
4. **Backward Compatibility**: This fix maintains compatibility with existing particle physics calculations while resolving the rendering issue

This fix restored the core functionality of the Nebula AUSP particle system and ensures a smooth user experience for both sandbox exploration and benchmark testing.