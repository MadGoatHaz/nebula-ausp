<div align="center">

<img src="public/NebulaLogo.png" alt="Nebula Logo" width="250">

# **Nebula AUSP**

### The Adaptive Universal System Profiler

**A next-generation, browser-based benchmark that provides a comprehensive performance profile of your system.**

<br>

<a href="https://madgoathaz.github.io/nebula-ausp/">
  <img src="https://img.shields.io/badge/View_Live_Demo-22CC77?style=for-the-badge&logo=rocket&logoColor=white" alt="Live Demo">
</a>
<a href="https://github.com/MadGoatHaz/nebula-ausp/actions/workflows/deploy.yml">
  <img src="https://github.com/MadGoatHaz/nebula-ausp/actions/workflows/deploy.yml/badge.svg" alt="Build Status">
</a>
<a href="https://github.com/sponsors/MadGoatHaz">
  <img src="https://img.shields.io/static/v1?label=Sponsor&message=%E2%9D%A4&logo=GitHub&color=%23fe8e86&style=for-the-badge" alt="Sponsor">
</a>

</div>

---

![Nebula AUSP Screenshot](./public/screenshot.png)

---

### **About The Project**

**Nebula AUSP (Adaptive Universal System Profiler)** is a personal, one-person project that I am building as a cutting-edge benchmarking tool for the modern web. It moves beyond simple FPS counters to run a **gauntlet of specialized tests** that isolate and measure the performance of key system components, including the CPU, GPU, and memory bandwidth.

My core philosophy is **adaptive testing**. Nebula intelligently detects your system's capabilities to run a tailored set of tests. This ensures that any device—from a low-power laptop to a high-end gaming rig—can receive a meaningful and comparable score, creating a fair and competitive platform for all users.

---

### **Understanding CPU vs GPU Bottlenecks**

Nebula AUSP includes a live metrics panel that surfaces:

- Physics step time (ms) — CPU-bound simulation and scheduling work.
- Render time (ms) — GPU-bound frame rendering and post-processing.
- FPS and related frame diagnostics.

By looking at the relationship between these values, you can quickly infer which part of your pipeline is the limiting factor:

- If physics (CPU) ms is significantly higher than render (GPU) ms, your CPU-side work (e.g., physics, scene updates, main-thread overhead) is likely the bottleneck.
- If render (GPU) ms is higher than physics (CPU) ms, your GPU is likely the limiting factor, especially under heavy shader, fill-rate, or post-processing load.
- Where these timings intersect or track closely, Nebula helps highlight the balance point between CPU and GPU workloads so you can better understand how your system behaves under real-time, mixed CPU/GPU pressure.

---

### **Key Features**

- **Comprehensive "Gauntlet" Benchmark:** A multi-stage test that analyzes various aspects of your system, including a Max-Q Search, GPU Stress Test, and CPU Stress Test.
- **Advanced Physics Simulation:** A multi-threaded physics engine simulating hundreds of thousands of particles interacting with a central black hole.
- **Rich & Dynamic Visuals:** Rendered with Three.js, featuring a procedural accretion disk, polar jets, and a multi-layered nebula, all running in real-time.
- **Live Diagnostics:** An on-screen panel providing real-time insight into FPS, particle counts, and benchmark progress.
- **Modern Tech Stack:** Built with Vite.js, modular JavaScript, and a Web Worker architecture for maximum performance and maintainability.

---

### **Tech Stack**

The project is built with a modern, modular frontend stack.

| Tech | Role |
| :--- | :--- |
| **Three.js** | 3D Rendering |
| **Vite.js** | Frontend Tooling |
| **Web Workers** | Multi-threaded Physics |
| **Express.js** | Leaderboard Backend |
| **gh-pages** | Deployment |

---

### ❤️ Support This Project

If you find Nebula AUSP impressive, please consider supporting its development. Your support directly helps me continue exploring and improving next-generation web benchmarks.

- **[Sponsor on GitHub](https://github.com/sponsors/MadGoatHaz)**
- **[Send a tip via PayPal](https://paypal.me/garretthazlett)**

---

### **Current Release**

Current alpha snapshot: **v0.9.21-alpha**

This alpha includes:

- Stabilized physics/render loop with reduced flicker at high particle counts.
- Deterministic benchmark flow with warm-up phases and synchronized state updates.
- Enhanced System Info panel and performance graphs for clearer diagnostics.
- Working local leaderboard backed by Express + SQLite with proper scoring.

Historical details and deep-dive architecture notes are documented in [`PROJECT_NEBULA_GUIDE.md`](nebula-ausp/PROJECT_NEBULA_GUIDE.md:1).

---

### **Development Roadmap (Updated)**

My vision for Nebula AUSP remains ambitious. I am building this as the ultimate tool for system profiling on the web. This is the current high-level roadmap. See the [open issues](https://github.com/MadGoatHaz/nebula-ausp/issues) for implementation details.

---

### **Phase 1: Foundation & Core Benchmark**

- **Status:** ✅ **Complete**
- **Objective:** Establish a robust, modern architecture and implement the core multi-stage benchmark "gauntlet."
- **Key Results:**
  - [x] **Modern Tooling:** Project fully migrated to Vite.js for a fast development experience and optimized builds.
  - [x] **Decoupled Architecture:** Physics engine isolated in a Web Worker, ensuring a smooth, non-blocking UI.
  - [x] **Adaptive Max-Q Search:** Initial benchmark stage that intelligently finds the maximum particle load a system can handle at a target FPS.
  - [x] **Gauntlet Implemented:** Multi-stage stress tests for GPU (fill-rate, shaders), CPU (physics, collisions), and combined system load.
  - [x] **Scoring v1.0:** A foundational scoring algorithm that provides a comprehensive and comparable metric based on gauntlet results.

---

### **Phase 2: Leaderboard & Community**

- **Status:** 🔳 **In Progress**
- **Objective:** Build the backend services and frontend UI for a global leaderboard, evolving this personal tool into a publicly shareable benchmarking platform.
- **Key Tasks:**
  - [ ] **System Info Collector:** Enhance the system profiler to gather more detailed (but still privacy-respecting) hardware information to accompany scores.
  - [ ] **Backend API:** Develop a lightweight, serverless backend (e.g., Cloudflare Workers) to securely receive and process benchmark submissions.
  - [ ] **Persistent Storage:** Implement a reliable database (e.g., KV store, D1, or PostgreSQL) to store scores and system profiles.
  - [ ] **Submission UI:** Refine the "Submit Score" flow within the application for a seamless user experience.
  - [ ] **Live Leaderboard:** Create a public-facing leaderboard page with filtering, sorting, and direct links to individual results.

---

### **Phase 3: The Next Frontier - Advanced Testing**

- **Status:** 🔲 **Planned**
- **Objective:** Push the boundaries of web-based benchmarking by leveraging cutting-edge browser technologies to reward and analyze modern hardware.
- **Key Tasks:**
  - [ ] **WASM/SIMD Physics Test:** Develop a hyper-optimized physics simulation in Rust or C++, compiled to WebAssembly, to measure raw, single-threaded CPU performance with SIMD where available.
  - [ ] **GPGPU Compute Test:** Move the N-body physics simulation from a Web Worker to a WebGPU compute shader as a large-scale GPGPU test.
  - [ ] **WebGPU Ray Tracing Test:** Create a visually rich scene designed to test dedicated RT hardware, running only when WebGPU ray tracing is available.

---

### **Future Plans**

To make Nebula AUSP even more effective at explaining real-world performance characteristics at a glance, I plan to add:

- **Visual CPU/GPU Intersection & Bottleneck Highlighting:** A dedicated visualization layer that clearly shows where physics (CPU) ms and render (GPU) ms intersect, diverge, and which side is acting as the bottleneck across different stages of the benchmark.
- **Aggregate Performance Metrics:** Support for rolling and session-level averages for:
  - FPS
  - Physics step time (ms)
  - Render time (ms)  
  alongside current values, making it easier to understand sustained performance, spikes, and stability without manually sampling or screen-watching.

---

### **Getting Started (Local)**

1. **Clone the repo**
   ```sh
   git clone https://github.com/MadGoatHaz/nebula-ausp.git
   cd nebula-ausp
   ```

2. **Install dependencies**
   ```sh
   npm install
   ```

3. **Run frontend + leaderboard backend together (recommended for dev)**
   ```sh
   npm run dev:full
   ```
   - Vite dev server: http://localhost:5173/nebula-ausp/
   - Leaderboard API: http://localhost:3000

4. **Alternative (frontend only)**
   ```sh
   npm run dev
   ```
   (Score submission & leaderboard will fail unless the API is also running via `npm run server`.)

---

> **License** · Distributed under the GPL-3.0 License. See `LICENSE` for more information.