import './style.css';
import { createUI, initUI, updateUI } from './components/ui.js';
import { createScene } from './components/scene.js';
import { BenchmarkController, State } from './core/benchmark.js';
import { Log } from './core/log.js';
import { getSystemInfo } from './core/profiler.js';
import * as THREE from 'three';
import { GUI } from 'lil-gui';
import packageJson from '../package.json';

// --- CONSTANTS ---
const PARTICLE_STRIDE = 8; // (x, y, z, vx, vy, vz, size, age)
const MAX_PARTICLES = 500000;
const MOON_ORBIT_RADIUS = 3000;

// --- INITIALIZATION ---
const ui = createUI();
const gui = new GUI();
const {
    scene, camera, renderer, composer, controls,
    diskMaterial, moon, nebulaMaterials,
    filmPass
} = createScene(gui);
document.body.insertBefore(renderer.domElement, document.getElementById('ui-container'));

const clock = new THREE.Clock();
let systemCapabilities = {};

const physicsWorker = new Worker(new URL('./core/physics.worker.js', import.meta.url), { type: 'module' });
const benchmarkController = new BenchmarkController();
const log = new Log();
let dataView = null;
let particleInstances = null;
let animationFrameId = null;

// --- MAIN ---
async function main() {
    initUI(ui, benchmarkController, physicsWorker, log);
    ui.version.textContent = `v${packageJson.version}`;
    systemCapabilities = await getSystemInfo();
    console.log("System Capabilities:", systemCapabilities);
    
    // Create particle instances mesh
    const particleMaterial = new THREE.ShaderMaterial({
        uniforms: {
            uTime: { value: 0.0 },
        },
        vertexShader: `
            attribute vec3 instanceColor;
            attribute vec3 velocity;
            varying vec3 vColor;
            varying float vSpeed;
            void main() {
                vColor = instanceColor;
                vSpeed = length(velocity);
                vec3 p = position;
                vec3 viewUp = vec3(modelViewMatrix[0][1], modelViewMatrix[1][1], modelViewMatrix[2][1]);
                vec3 viewRight = vec3(modelViewMatrix[0][0], modelViewMatrix[1][0], modelViewMatrix[2][0]);
                vec3 stretched = p;
                if (vSpeed > 1.0) {
                   vec3 dir = normalize(velocity);
                   stretched += dir * vSpeed * 0.01; // Motion blur
                }
                gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(stretched, 1.0);
            }
        `,
        fragmentShader: `
            varying vec3 vColor;
            void main() {
                gl_FragColor = vec4(vColor * 1.5, 1.0); // Boost color for bloom
            }
        `
    });
    
    particleInstances = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(5, 0), particleMaterial, MAX_PARTICLES);
    particleInstances.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    scene.add(particleInstances);


    physicsWorker.onmessage = (e) => {
        switch (e.data.type) {
            case 'physics_update':
                if (e.data.buffer) {
                    dataView = new Float32Array(e.data.buffer);
                    if (!animationFrameId) {
                       animationFrameId = requestAnimationFrame(animate);
                    }
                }
                break;
            case 'benchmark_update':
                benchmarkController.handleWorkerUpdate(e.data.payload, log);
                updateUI(ui, benchmarkController.state, benchmarkController.currentParticleCount);
                break;
            case 'benchmark_complete':
                benchmarkController.handleCompletion(e.data.results, systemCapabilities, log);
                updateUI(ui, benchmarkController.state);
                ui.showSubmitButton();
                break;
        }
    };

    physicsWorker.postMessage({ type: 'init', maxParticles: MAX_PARTICLES });
    physicsWorker.postMessage({ type: 'set_particles', count: parseInt(ui.sandboxControls.particles.value) });
}

// --- ANIMATION ---
function animate() {
    animationFrameId = requestAnimationFrame(animate);

    if (!dataView) return; 

    const dt = clock.getDelta();
    const elapsedTime = clock.getElapsedTime();

    const particleCount = dataView.length / PARTICLE_STRIDE;
    
    diskMaterial.uniforms.uTime.value = elapsedTime;
    nebulaMaterials.forEach(m => m.uniforms.uTime.value = elapsedTime);
    if (filmPass) filmPass.uniforms.time.value = elapsedTime;

    moon.position.set(
        Math.cos(elapsedTime * 0.1) * MOON_ORBIT_RADIUS,
        0,
        Math.sin(elapsedTime * 0.1) * MOON_ORBIT_RADIUS
    );
    physicsWorker.postMessage({ type: 'update_moon', x: moon.position.x, y: moon.position.y, z: moon.position.z });


    updateParticles(particleCount, elapsedTime);

    controls.update();
    composer.render(dt);
}

function updateParticles(particleCount, elapsedTime) {
    const temp = new THREE.Object3D();
    const color = new THREE.Color();
    const baseHue = 0.6; // Blueish
    const hueVariance = 0.1;

    for (let i = 0; i < particleCount; i++) {
        const offset = i * PARTICLE_STRIDE;
        temp.position.set(dataView[offset], dataView[offset + 1], dataView[offset + 2]);
        temp.updateMatrix();
        particleInstances.setMatrixAt(i, temp.matrix);

        const vx = dataView[offset + 3];
        const vy = dataView[offset + 4];
        const vz = dataView[offset + 5];
        const speed = Math.sqrt(vx * vx + vy * vy + vz * vz);
        
        const hue = baseHue + (i % 20 / 20) * hueVariance;
        const saturation = Math.max(0.2, 1.0 - speed / 400);
        const lightness = Math.min(1.0, 0.4 + speed / 200.0);
        color.setHSL(hue, saturation, lightness);
        particleInstances.setColorAt(i, color);
    }
    particleInstances.count = particleCount;
    particleInstances.instanceMatrix.needsUpdate = true;
    if (particleInstances.instanceColor) {
        particleInstances.instanceColor.needsUpdate = true;
    }
}

main().catch(console.error);

ui.leaderboardBtn.addEventListener('click', () => {
    window.location.href = 'leaderboard.html';
});