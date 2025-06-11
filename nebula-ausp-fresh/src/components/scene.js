import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { FilmShader } from './FilmShader.js';
import { VignetteShader } from './VignetteShader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const STAR_COUNT = 15000;
const JET_PARTICLE_COUNT = 8000;

export function createScene(gui) {
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 40000);
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(window.innerWidth, window.innerHeight);

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.2);
    scene.add(ambientLight);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;

    const composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));

    const bloomPass = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 1.0, 0.4, 0.1);
    composer.addPass(bloomPass);

    const filmPass = new ShaderPass(FilmShader);
    composer.addPass(filmPass);

    const vignettePass = new ShaderPass(VignetteShader);
    composer.addPass(vignettePass);

    // GUI
    const postprocessingFolder = gui.addFolder('Post-Processing');
    postprocessingFolder.add(bloomPass, 'strength', 0.0, 3.0).name('Bloom');
    
    const filmFolder = postprocessingFolder.addFolder('Film Grain');
    filmFolder.add(filmPass.uniforms.nIntensity, 'value', 0, 1).name('Noise Intensity');
    filmFolder.add(filmPass.uniforms.sIntensity, 'value', 0, 1).name('Scanline Intensity');
    filmFolder.add(filmPass.uniforms.sCount, 'value', 0, 4096).name('Scanline Count');
    filmPass.uniforms.grayscale.value = 0;

    const vignetteFolder = postprocessingFolder.addFolder('Vignette');
    vignetteFolder.add(vignettePass.uniforms.offset, 'value', 0, 2).name('Offset');
    vignetteFolder.add(vignettePass.uniforms.darkness, 'value', 0, 2).name('Darkness');

    const blackHoleMesh = new THREE.Mesh(new THREE.SphereGeometry(100, 32, 32), new THREE.MeshBasicMaterial({ color: 0x000000 }));
    scene.add(blackHoleMesh);

    const starGeometry = new THREE.BufferGeometry();
    const starPositions = [];
    for (let i = 0; i < STAR_COUNT; i++) { starPositions.push(THREE.MathUtils.randFloatSpread(30000), THREE.MathUtils.randFloatSpread(30000), THREE.MathUtils.randFloatSpread(30000)); }
    starGeometry.setAttribute('position', new THREE.Float32BufferAttribute(starPositions, 3));
    scene.add(new THREE.Points(starGeometry, new THREE.PointsMaterial({ color: 0x888888, size: 1.5 })));
    
    const photonRing = new THREE.Mesh(new THREE.RingGeometry(105, 115, 128), new THREE.MeshBasicMaterial({ color: 0xffaa00, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, transparent: true, opacity: 0.8 }));
    photonRing.rotation.x = Math.PI / 2;
    scene.add(photonRing);

    const diskMaterial = new THREE.ShaderMaterial({
        uniforms: { uTime: { value: 0 } },
        vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
        fragmentShader: `
            varying vec2 vUv; uniform float uTime;
            vec3 permute(vec3 x) { return mod(((x*34.0)+1.0)*x, 289.0); }
            float snoise(vec2 v) {
                const vec4 C = vec4(0.211324865405187, 0.366025403784439, -0.577350269189626, 0.024390243902439);
                vec2 i  = floor(v + dot(v, C.yy) ); vec2 x0 = v - i + dot(i, C.xx);
                vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
                vec4 x12 = x0.xyxy + C.xxzz; x12.xy -= i1; i = mod(i, 289.0);
                vec3 p = permute( permute( i.y + vec3(0.0, i1.y, 1.0 )) + i.x + vec3(0.0, i1.x, 1.0 ));
                vec3 m = max(0.5 - vec3(dot(x0,x0), dot(x12.xy,x12.xy), dot(x12.zw,x12.zw)), 0.0);
                m = m*m; m = m*m; vec3 x = 2.0 * fract(p * C.www) - 1.0; vec3 h = abs(x) - 0.5;
                vec3 ox = floor(x + 0.5); vec3 a0 = x - ox; m *= 1.79284291400159 - 0.85373472095314 * ( a0*a0 + h*h );
                vec3 g; g.x  = a0.x  * x0.x  + h.x  * x0.y; g.yz = a0.yz * x12.xz + h.yz * x12.yw;
                return 130.0 * dot(m, g);
            }
            void main() {
                vec2 uv = vUv; float dist = distance(uv, vec2(0.5));
                float angle = atan(uv.y - 0.5, uv.x - 0.5); float radius = dist;
                uv.x = 0.5 + radius * cos(angle - uTime * 0.2 - radius * 5.0);
                uv.y = 0.5 + radius * sin(angle - uTime * 0.2 - radius * 5.0);
                float noise = (snoise(uv * 5.0) + 1.0) * 0.5;
                vec3 color = vec3(1.0, 0.5, 0.1) * noise;
                float falloff = 1.0 - smoothstep(0.4, 0.5, dist);
                gl_FragColor = vec4(color, falloff);
            }`,
        transparent: true, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, depthWrite: false
    });
    const accretionDisk = new THREE.Mesh(new THREE.RingGeometry(120, 400, 128), diskMaterial);
    accretionDisk.rotation.x = Math.PI / 2;
    scene.add(accretionDisk);

    const jetGeometry = new THREE.BufferGeometry();
    jetGeometry.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(JET_PARTICLE_COUNT * 3), 3));
    const jets = new THREE.Points(jetGeometry, new THREE.PointsMaterial({ color: 0x00aaff, size: 3.5, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.7, transparent: true }));
    scene.add(jets);
    const jetParticles = Array.from({ length: JET_PARTICLE_COUNT }, () => ({ velocity: new THREE.Vector3(), lifetime: 0, initialLifetime: 1 }));

    const moon = new THREE.Mesh( new THREE.SphereGeometry(20, 32, 32), new THREE.MeshStandardMaterial({ color: 0x00ff88, emissive: 0x00ff88, emissiveIntensity: 2 }) );
    scene.add(moon);

    const nebulaMaterials = [];
    const nebulaColors = [
        { color1: new THREE.Color(0x0d0033), color2: new THREE.Color(0x1a0066) },
        { color1: new THREE.Color(0x330033), color2: new THREE.Color(0x4d004d) },
        { color1: new THREE.Color(0x660066), color2: new THREE.Color(0x800080) }
    ];
    const nebulaSpeeds = [0.02, 0.03, 0.04];
    const nebulaScales = [0.00015, 0.0002, 0.00025];

    for (let i = 0; i < 3; i++) {
        const material = new THREE.ShaderMaterial({
            uniforms: {
                uTime: { value: 0 },
                uSpeed: { value: nebulaSpeeds[i] },
                uScale: { value: nebulaScales[i] },
                uColor1: { value: nebulaColors[i].color1 },
                uColor2: { value: nebulaColors[i].color2 }
            },
            vertexShader: `
                varying vec3 vWorldPosition;
                void main() {
                    vec4 worldPosition = modelMatrix * vec4(position, 1.0);
                    vWorldPosition = worldPosition.xyz;
                    gl_Position = projectionMatrix * viewMatrix * worldPosition;
                }
            `,
            fragmentShader: `
                uniform float uTime;
                uniform float uSpeed;
                uniform float uScale;
                uniform vec3 uColor1;
                uniform vec3 uColor2;
                varying vec3 vWorldPosition;

                vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
                vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
                vec4 permute(vec4 x) { return mod289(((x*34.0)+1.0)*x); }
                vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }
                float snoise(vec3 v) {
                    const vec2 C = vec2(1.0/6.0, 1.0/3.0);
                    const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
                    vec3 i  = floor(v + dot(v, C.yyy));
                    vec3 x0 = v - i + dot(i, C.xxx);
                    vec3 g = step(x0.yzx, x0.xyz);
                    vec3 l = 1.0 - g;
                    vec3 i1 = min(g.xyz, l.zxy);
                    vec3 i2 = max(g.xyz, l.zxy);
                    vec3 x1 = x0 - i1 + C.xxx;
                    vec3 x2 = x0 - i2 + C.yyy;
                    vec3 x3 = x0 - D.yyy;
                    i = mod289(i);
                    vec4 p = permute(permute(permute(
                                i.z + vec4(0.0, i1.z, i2.z, 1.0))
                            + i.y + vec4(0.0, i1.y, i2.y, 1.0))
                            + i.x + vec4(0.0, i1.x, i2.x, 1.0));
                    float n_ = 0.142857142857;
                    vec3 ns = n_ * D.wyz - D.xzx;
                    vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
                    vec4 x_ = floor(j * ns.z);
                    vec4 y_ = floor(j - 7.0 * x_);
                    vec4 x = x_ * ns.x + ns.yyyy;
                    vec4 y = y_ * ns.x + ns.yyyy;
                    vec4 h = 1.0 - abs(x) - abs(y);
                    vec4 b0 = vec4(x.xy, y.xy);
                    vec4 b1 = vec4(x.zw, y.zw);
                    vec4 s0 = floor(b0)*2.0 + 1.0;
                    vec4 s1 = floor(b1)*2.0 + 1.0;
                    vec4 sh = -step(h, vec4(0.0));
                    vec4 a0 = b0.xzyw + s0.xzyw*sh.xxyy;
                    vec4 a1 = b1.xzyw + s1.xzyw*sh.zzww;
                    vec3 p0 = vec3(a0.xy,h.x);
                    vec3 p1 = vec3(a0.zw,h.y);
                    vec3 p2 = vec3(a1.xy,h.z);
                    vec3 p3 = vec3(a1.zw,h.w);
                    vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2,p2), dot(p3,p3)));
                    p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
                    vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
                    m = m * m;
                    return 42.0 * dot(m*m, vec4(dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3)));
                }

                void main() {
                    float noise = snoise(vWorldPosition * uScale + uTime * uSpeed);
                    noise = (noise + 1.0) * 0.5;
                    noise = pow(noise, 3.0);
                    vec3 color = mix(uColor1, uColor2, noise);
                    gl_FragColor = vec4(color, noise * 0.5);
                }
            `,
            side: THREE.BackSide,
            transparent: true,
            blending: THREE.AdditiveBlending
        });
        nebulaMaterials.push(material);
        const nebula = new THREE.Mesh(new THREE.SphereGeometry(20000 - i * 5000, 32, 32), material);
        scene.add(nebula);
    }

    function onResize() {
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
        composer.setSize(window.innerWidth, window.innerHeight);
    }
    window.addEventListener('resize', onResize);

    return { scene, camera, renderer, composer, controls, accretionDisk, diskMaterial, jets, jetParticles, moon, nebulaMaterials, filmPass, vignettePass };
}