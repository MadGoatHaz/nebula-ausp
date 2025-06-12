<div align="center">
  <img src="public/NebulaLogo.png" alt="Nebula Logo" width="200">
  <h1>Nebula AUSP</h1>
  <p><strong>The Adaptive Universal System Profiler</strong></p>
  <p>A next-generation, browser-based benchmark that provides a comprehensive performance profile of your system.</p>
  <p>
    <a href="https://madgoathaz.github.io/nebula-ausp/"><strong>Live Demo »</strong></a>
  </p>
  <p>
    <a href="https://github.com/MadGoatHaz/nebula-ausp/actions"><img src="https://img.shields.io/github/actions/workflow/status/MadGoatHaz/nebula-ausp/main.yml?branch=main&style=for-the-badge" alt="Build Status"></a>
    <a href="https://github.com/MadGoatHaz/nebula-ausp/blob/main/LICENSE"><img src="https://img.shields.io/github/license/MadGoatHaz/nebula-ausp?style=for-the-badge" alt="License"></a>
    <a href="https://github.com/sponsors/MadGoatHaz"><img src="https://img.shields.io/static/v1?label=Sponsor&message=%E2%9D%A4&logo=GitHub&color=%23fe8e86&style=for-the-badge" alt="Sponsor"></a>
  </p>
</div>

![Nebula AUSP Screenshot](public/screenshot.png)

---

## About The Project

**Nebula AUSP (Adaptive Universal System Profiler)** is a cutting-edge benchmarking tool designed for the modern web. It moves beyond simple FPS counters to run a **gauntlet of specialized tests** that isolate and measure the performance of key system components, including the CPU, GPU, and memory bandwidth.

The core philosophy is **adaptive testing**. Nebula intelligently detects your system's capabilities to run a tailored set of tests. This ensures that any device—from a low-power laptop to a high-end gaming rig—can receive a meaningful and comparable score, creating a fair and competitive platform for all users.

## Key Features

*   **Comprehensive "Gauntlet" Benchmark:** A multi-stage test that analyzes various aspects of your system:
    *   **Max-Q Search:** Automatically finds the maximum particle workload your system can sustain at a target FPS.
    *   **GPU Stress Test:** Isolates fragment shader and fill-rate performance.
    *   **CPU Stress Test:** Measures raw computation and physics simulation performance.
    *   **Combined Load Test:** Measures performance under a realistic, mixed workload.
*   **Advanced Physics Simulation:** A multi-threaded physics engine simulates hundreds of thousands of particles, interacting with a central black hole and an orbiting moon.
*   **Rich Visuals:** Rendered with Three.js, the scene features a procedural accretion disk, polar jets, and a multi-layered nebula, all running in real-time.
*   **Live Diagnostics:** An on-screen panel provides real-time insight into FPS, particle counts, and benchmark progress.
*   **Modern Tech Stack:** Built with Vite.js, modular JavaScript, and a Web Worker architecture for maximum performance and maintainability.

## Tech Stack

*   [**Three.js**](https://threejs.org/) - 3D Rendering
*   [**Vite.js**](https://vitejs.dev/) - Frontend Tooling
*   **Web Workers** - Multi-threaded Physics
*   **Express.js** - Leaderboard Backend
*   **gh-pages** - Deployment

---

## Development Roadmap

Our progress is tracked in phases. See the [open issues](https://github.com/MadGoatHaz/nebula-ausp/issues) for a full list of proposed features (and known bugs).

### ✅ Phase 1: Core Benchmark
- [x] **Project Restructuring:** Migrate to a modern, modular Vite.js structure.
- [x] **Capability Scan:** Detect system capabilities on startup.
- [x] **"Gauntlet" Implementation:** Build the multi-stage benchmark process.
- [x] **Scoring Algorithm v1.0:** Implement a composite scoring algorithm.

### 🔳 Phase 2: Leaderboard & Data
- [ ] **System Info Collector:** Gather detailed (but privacy-respecting) hardware information.
- [ ] **Backend API:** Develop a service to receive and store benchmark submissions.
- [ ] **Database:** Set up a database to store scores and system information.
- [ ] **Submission UI:** Implement a "Submit Score" feature in the application.
- [ ] **Leaderboard UI:** Create a public-facing leaderboard page.

### 🔳 Phase 3: Advanced Tests
- [ ] **WASM/SIMD Physics:** Develop a hyper-optimized physics loop in Rust or C++.
- [ ] **WebGPU Compute:** Move the entire physics simulation to a WebGPU compute shader.
- [ ] **WebGPU Ray Tracing:** Create a new scene to test dedicated RT hardware.

---

## Getting Started

To get a local copy up and running, follow these simple steps.

### Prerequisites

*   **Node.js & npm:** Download and install from [nodejs.org](https://nodejs.org/).

### Installation

1.  Clone the repository:
    ```sh
    git clone https://github.com/MadGoatHaz/nebula-ausp.git
    ```
2.  Navigate to the project directory:
    ```sh
    cd nebula-ausp
    ```
3.  Install NPM packages:
    ```sh
    npm install
    ```
4.  Run the development server:
    ```sh
    npm run dev
    ```
    Now, open your browser to the local URL provided by Vite (e.g., `http://localhost:5173`).

---

## License

Distributed under the MIT License. See `LICENSE` for more information.