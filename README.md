<div align="center">
  <img src="public/nebula-logo-trans.png" alt="Nebula Logo" width="150">
  <h1>Nebula AUSP</h1>
  <p><strong>The Adaptive Universal System Profiler</strong></p>
  <p>
    A next-generation, browser-based benchmarking suite designed to provide a comprehensive performance profile of your entire system.
  </p>
  <p>
    <a href="https://github.com/MadGoatHaz/nebula-ausp/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License"></a>
    <a href="https://github.com/MadGoatHaz/nebula-ausp/actions"><img src="https://img.shields.io/github/actions/workflow/status/MadGoatHaz/nebula-ausp/main.yml?branch=main" alt="Build Status"></a>
    <a href="https://madgoathaz.github.io/nebula-ausp/"><img src="https://img.shields.io/badge/Live-Demo-brightgreen" alt="Live Demo"></a>
  </p>
</div>

---

## **Live Demo & Screenshot**

**[Click here to view the live benchmark!](https://madgoathaz.github.io/nebula-ausp/)**

![Nebula AUSP Screenshot](public/screenshot.png)

---

## **Vision: A Universal Benchmark for the Modern Web**

**Project: Nebula** aims to be the go-to destination for users to quickly and accurately measure the performance of their entire system. It moves beyond simple FPS counters to run a **gauntlet of specialized tests** that isolate and measure the performance of five key domains: **CPU, Physics, 3D Graphics, AI Inference, and Ray Tracing.**

The core philosophy is **adaptive testing**. Nebula intelligently detects a system's hardware and software capabilities to run a tailored set of tests. This ensures that any device—from a Raspberry Pi to a high-end workstation—can receive a meaningful and comparable score, creating a fair and competitive platform for all users.

## **Live Demo**

**[Link to your live GitHub Pages site will go here]**

---

## **Core Features**

*   **Modular & Modern Codebase:** Built with vanilla JavaScript modules and the **Vite.js** build tool for speed and maintainability.
*   **Live Diagnostic Logging:** An on-screen log provides real-time insight into the application's state and benchmark progress.
*   **Comprehensive "Gauntlet" Benchmark:** A multi-stage test that includes:
    *   **Max-Q Search:** Automatically finds the maximum particle workload your system can sustain at a target FPS.
    *   **GPU Stress Test:** Isolates fragment shader and fill-rate performance.
    *   **CPU Stress Test:** Isolates raw computation and branching performance with an "Extreme" physics simulation.
    *   **Combined Load Test:** Measures performance under a realistic, mixed workload.
*   **Advanced Physics Simulation:** A multi-threaded physics engine simulates up to 150,000 particles under various gravitational models, including N-body and particle-particle collisions.
*   **Visually Rich 3D Scene:** Features a black hole with a procedural accretion disk, polar jets, an orbiting moon, and a multi-layered, animated nebula background.
*   **Capability-Aware Architecture (Future):** The framework is in place to run bonus tests for advanced hardware features like WebGPU Ray Tracing and WASM SIMD.

---

## **Technical Architecture**

The application is built with a modern, modular frontend stack.

*   **3D Rendering:** [**Three.js**](https://threejs.org/) is used for all WebGL rendering and post-processing.
*   **Physics Engine:** A custom, multi-threaded physics engine runs in a separate **Web Worker** to prevent blocking the main render thread. State is shared between threads using a `SharedArrayBuffer`.
*   **Build Tool:** [**Vite.js**](https://vitejs.dev/) provides an incredibly fast development server with Hot Module Replacement (HMR) and optimizes the project for production.
*   **Language:** The entire frontend is written in modern, modular **JavaScript (ESM)**.

The project is structured into logical components:
*   `/src/components/`: Manages the creation of the UI (`ui.js`) and the THREE.js scene (`scene.js`).
*   `/src/core/`: Contains the core application logic, including the `BenchmarkController`, `SystemProfiler`, and `Log` generators.
*   `/src/physics/`: Contains the code for the dedicated physics Web Worker.

---

## **Development Roadmap**

This project is developed in phases. Our progress is tracked below.

### **Phase 1: The "Gauntlet" - Core Benchmark Implementation**
*   **Status:** ✅ **Complete**
*   **Objective:** Implement the full, multi-domain, capability-aware benchmark suite.
*   **Key Tasks:**
    - [x] **Project Restructuring:** Migrate the entire existing codebase into the new Vite-powered modular structure.
    - [x] **Capability Scan:** Implement the `SystemProfiler` to detect CPU cores, WebGPU support, and Ray Tracing features on startup.
    - [x] **Gauntlet Implementation:** Re-architect the benchmark into a multi-stage process (Max-Q Search, GPU Test, CPU Test, Combined Test).
    - [x] **Scoring Algorithm v1.0:** Implement a composite scoring algorithm based on the results of the Gauntlet tests.

### **Phase 2: Leaderboard & Data Integration**
*   **Status:** 🔲 (Planned)
*   **Objective:** Create the backend and frontend for a live, public leaderboard.
*   **Key Tasks:**
    - [ ] **System Info Collector:** Enhance the profiler to gather more detailed (but still privacy-respecting) hardware information.
    - [ ] **Backend API:** Develop a simple backend service (e.g., using Cloudflare Workers or a similar serverless platform) to receive and store benchmark submissions.
    - [ ] **Database:** Set up a database (e.g., KV store, PostgreSQL) to store scores and system information.
    - [ ] **Submission UI:** Add a "Submit Score to Leaderboard" feature to the application.
    - [ ] **Leaderboard UI:** Create a public-facing leaderboard page that can be filtered and sorted.

### **Phase 3: Capability-Aware Bonus Tests**
*   **Status:** 🔲 (Planned)
*   **Objective:** Implement the advanced, capability-gated bonus tests to reward modern hardware.
*   **Key Tasks:**
    - [ ] **WASM/SIMD Physics Test:** Develop a hyper-optimized physics loop in Rust or C++, compile to WebAssembly, and run it if the system supports SIMD.
    - [ ] **WebGPU Compute Test:** Move the entire physics simulation to a WebGPU compute shader for a massive GPGPU test.
    - [ ] **WebGPU Ray Tracing Test:** Create a new, visually stunning scene specifically designed to test dedicated RT hardware, which will only run if `navigator.gpu.adapter.features` reports support for it.

---

## **Getting Started**

### **Prerequisites**

*   **Node.js & npm:** You must have Node.js (which includes npm) installed. You can download it from [nodejs.org](https://nodejs.org/).
*   **A Modern Browser:** An up-to-date version of Chrome, Edge, or Firefox.

### **Installation & Running**

1.  **Clone the repository:**
    ```bash
    git clone https://github.com/MadGoatHaz/nebula-ausp.git
    cd nebula-ausp
    ```

2.  **Install dependencies:**
    ```bash
    npm install
    ```

3.  **Run the development server:**
    ```bash
    npm run dev
    ```

4.  Open your browser and navigate to the local URL provided by Vite (usually `http://localhost:5173`).

---

## **License**

This project is licensed under the **MIT License**.