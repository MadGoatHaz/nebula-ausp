# Project Nebula: Definitive Handoff & Developer's Guide
**Version:** v0.20.0 (Stable Baseline, Post-Fixes)
**Status:** Phase 1 Complete. Phase 2 In Progress.

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

## 6. Future Roadmap

### Phase 1: Foundation & Core Benchmark
*   **Status:** ✅ **Complete**
*   **Objective:** Establish a robust, modern architecture and implement the core multi-stage benchmark "gauntlet."
*   **Key Results:**
    - [x] **Modern Tooling:** Project fully migrated to Vite.js for a blazing-fast development experience and optimized builds.
    - [x] **Decoupled Architecture:** Physics engine isolated in a Web Worker, ensuring a smooth, non-blocking UI.
    - [x] **Adaptive Max-Q Search:** Initial benchmark stage that intelligently finds the maximum particle load a system can handle at a target FPS.
    - [x] **Gauntlet Implemented:** Multi-stage stress tests for GPU (fill-rate, shaders), CPU (physics, collisions), and combined system load.
    - [x] **Scoring v1.0:** A foundational scoring algorithm that provides a comprehensive and comparable metric based on gauntlet results.

### Phase 2: Leaderboard & Community
*   **Status:** 🔳 **In Progress**
*   **Objective:** Build the backend services and frontend UI for a global leaderboard, turning a personal tool into a community platform.
*   **Key Tasks:**
    - [ ] **System Info Collector:** Enhance the system profiler to gather more detailed (but still privacy-respecting) hardware information to accompany scores.
    - [ ] **Backend API:** Develop a lightweight, serverless backend (e.g., using Cloudflare Workers) to securely receive and process benchmark submissions.
    - [ ] **Persistent Storage:** Implement a reliable database (e.g., KV store, D1, or PostgreSQL) to store scores and system profiles.
    - [ ] **Submission UI:** Refine the "Submit Score" flow within the application for a seamless user experience.
    - [ ] **Live Leaderboard:** Create a public-facing leaderboard page with filtering, sorting, and direct links to individual results.

### Phase 3: The Next Frontier - Advanced Testing
*   **Status:** 🔲 **Planned**
*   **Objective:** Push the boundaries of web-based benchmarking by leveraging cutting-edge browser technologies to reward and analyze modern hardware.
*   **Key Tasks:**
    - [ ] **WASM/SIMD Physics Test:** Develop a hyper-optimized physics simulation in Rust or C++, compiled to WebAssembly. This will serve as a bonus test to measure raw, single-threaded CPU performance, leveraging SIMD where available.
    - [ ] **GPGPU Compute Test:** Move the entire N-body physics simulation from a Web Worker to a WebGPU compute shader. This will be a massive GPGPU test, measuring the parallel processing power of modern GPUs.
    - [ ] **WebGPU Ray Tracing Test:** Create a new, visually stunning scene specifically designed to test dedicated RT hardware. This advanced test will only run if the browser reports support for the WebGPU ray-tracing pipeline, providing a true measure of next-generation graphics capabilities.

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