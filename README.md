<div align="center">

<img src="public/NebulaLogo.png" alt="Nebula Logo" width="250">

# **Nebula AUSP**

### The Adaptive Universal System Profiler

**A next-generation, browser-based benchmark that provides a comprehensive performance profile of your system.**

<br>

<a href="https://madgoathaz.github.io/nebula-ausp/">
  <img src="https://img.shields.io/badge/View_Live_Demo-22CC77?style=for-the-badge&logo=rocket&logoColor=white" alt="Live Demo">
</a>
<a href="https://github.com/MadGoatHaz/nebula-ausp/actions">
  <img src="https://img.shields.io/github/actions/workflow/status/MadGoatHaz/nebula-ausp/main.yml?branch=main&style=for-the-badge" alt="Build Status">
</a>
<a href="https://github.com/sponsors/MadGoatHaz">
  <img src="https://img.shields.io/static/v1?label=Sponsor&message=%E2%9D%A4&logo=GitHub&color=%23fe8e86&style=for-the-badge" alt="Sponsor">
</a>

</div>

---

![Nebula AUSP Screenshot](public/screenshot.png)

---

### **About The Project**
**Nebula AUSP (Adaptive Universal System Profiler)** is a cutting-edge benchmarking tool designed for the modern web. It moves beyond simple FPS counters to run a **gauntlet of specialized tests** that isolate and measure the performance of key system components, including the CPU, GPU, and memory bandwidth.

> The core philosophy is **adaptive testing**. Nebula intelligently detects your system's capabilities to run a tailored set of tests. This ensures that any device—from a low-power laptop to a high-end gaming rig—can receive a meaningful and comparable score, creating a fair and competitive platform for all users.

---

### **Key Features**
-   **Comprehensive "Gauntlet" Benchmark:** A multi-stage test that analyzes various aspects of your system, including a Max-Q Search, GPU Stress Test, and CPU Stress Test.
-   **Advanced Physics Simulation:** A multi-threaded physics engine simulates hundreds of thousands of particles interacting with a central black hole.
-   **Rich & Dynamic Visuals:** Rendered with Three.js, the scene features a procedural accretion disk, polar jets, and a multi-layered nebula, all running in real-time.
-   **Live Diagnostics:** An on-screen panel provides real-time insight into FPS, particle counts, and benchmark progress.
-   **Modern Tech Stack:** Built with Vite.js, modular JavaScript, and a Web Worker architecture for maximum performance and maintainability.

---

### **Tech Stack**
The project is built with a modern, modular frontend stack.

| Tech | Role |
| :--- | :--- |
| **Three.js** | 3D Rendering |
| **Vite.js** | Frontend Tooling |
| **Web Workers**| Multi-threaded Physics |
| **Express.js** | Leaderboard Backend |
| **gh-pages** | Deployment |

---

### **Development Roadmap**
Our progress is tracked in phases. See the [open issues](https://github.com/MadGoatHaz/nebula-ausp/issues) for a full list of proposed features and known bugs.

- **✅ Phase 1: Core Benchmark**
- **🔳 Phase 2: Leaderboard & Data**
- **🔳 Phase 3: Advanced Tests (WASM, WebGPU)**

---

### **Getting Started**
To get a local copy up and running, follow these simple steps.

1.  **Clone the repo**
    ```sh
    git clone https://github.com/MadGoatHaz/nebula-ausp.git
    ```
2.  **Install NPM packages**
    ```sh
    cd nebula-ausp
    npm install
    ```
3.  **Run the dev server**
    ```sh
    npm run dev
    ```

---
> **License** · Distributed under the MIT License. See `LICENSE` for more information.