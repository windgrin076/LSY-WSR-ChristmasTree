import React, { useEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';

// @ts-ignore
import * as THREE from 'three';
// @ts-ignore
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
// @ts-ignore
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
// @ts-ignore
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
// @ts-ignore
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
// @ts-ignore
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
// @ts-ignore
import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision';

const App = () => {
  const mountRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const cvCanvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!mountRef.current || !videoRef.current || !cvCanvasRef.current) return;

    // --- 1. State Machine ---
    const MODES = {
      TREE: 'TREE',
      SCATTER: 'SCATTER',
      FOCUS: 'FOCUS'
    };

    const STATE = {
      mode: MODES.TREE,
      handPos: { x: 0, y: 0 },
      targetPhotoIndex: -1,
      particles: [] as any[],
      photos: [] as any[],
      dust: null as any,
      sparkles: null as any
    };

    // --- 2. Three.js Setup ---
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.set(0, 2, 50);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.toneMapping = THREE.ReinhardToneMapping;
    // Lower exposure to prevent burnout on photos and gold
    renderer.toneMappingExposure = 1.2; 
    mountRef.current.appendChild(renderer.domElement);

    // Environment
    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    scene.environment = pmremGenerator.fromScene(new RoomEnvironment(), 0.04).texture;

    // Post Processing
    const renderScene = new RenderPass(scene, camera);
    const bloomPass = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 1.5, 0.4, 0.85);
    // Tuned Bloom: Higher threshold prevents candy canes (white) from glowing pink
    // Strength increased to make the Gold Star and lights pop
    bloomPass.strength = 0.7; 
    bloomPass.radius = 0.5;
    bloomPass.threshold = 0.85; 

    const outputPass = new OutputPass();

    const composer = new EffectComposer(renderer);
    composer.addPass(renderScene);
    composer.addPass(bloomPass);
    composer.addPass(outputPass);

    // Lights
    const ambientLight = new THREE.AmbientLight(0xffeebb, 0.5);
    scene.add(ambientLight);

    const innerLight = new THREE.PointLight(0xffaa00, 3, 50); 
    innerLight.position.set(0, 5, 0);
    scene.add(innerLight);

    // Main Golden Spotlight
    const spotLightMain = new THREE.SpotLight(0xffd700, 1500);
    spotLightMain.position.set(30, 40, 40);
    spotLightMain.angle = Math.PI / 6;
    spotLightMain.penumbra = 1;
    scene.add(spotLightMain);

    // Warm Fill Light (Replaced the Blue light)
    const spotLightWarm = new THREE.SpotLight(0xffaa33, 500);
    spotLightWarm.position.set(-30, 20, -30);
    spotLightWarm.penumbra = 1;
    scene.add(spotLightWarm);

    // Group for rotation
    const mainGroup = new THREE.Group();
    scene.add(mainGroup);

    // --- 3. Assets & Particles ---
    const goldMat = new THREE.MeshStandardMaterial({ 
        color: 0xffcc00, 
        roughness: 0.2, 
        metalness: 1.0,
        emissive: 0x442200,
        emissiveIntensity: 0.2
    });
    const greenMat = new THREE.MeshStandardMaterial({ color: 0x0f3b1e, roughness: 0.6, metalness: 0.2 });
    const redMat = new THREE.MeshPhysicalMaterial({ color: 0xaa0000, roughness: 0.2, metalness: 0.1, clearcoat: 1.0, clearcoatRoughness: 0.1 });

    function createCandyCaneTexture() {
      const canvas = document.createElement('canvas');
      canvas.width = 128;
      canvas.height = 128;
      const ctx = canvas.getContext('2d');
      if (!ctx) return new THREE.CanvasTexture(canvas);
      // Use light grey instead of pure white to avoid bloom glare
      ctx.fillStyle = '#dddddd'; 
      ctx.fillRect(0, 0, 128, 128);
      ctx.fillStyle = '#b00000';
      ctx.beginPath();
      for (let i = -128; i < 256; i += 32) {
        ctx.moveTo(i, 0);
        ctx.lineTo(i + 16, 0);
        ctx.lineTo(i + 16 + 128, 128);
        ctx.lineTo(i + 128, 128);
        ctx.closePath();
      }
      ctx.fill();
      const tex = new THREE.CanvasTexture(canvas);
      tex.wrapS = THREE.RepeatWrapping;
      tex.wrapT = THREE.RepeatWrapping;
      tex.colorSpace = THREE.SRGBColorSpace;
      return tex;
    }

    function createSparkleTexture() {
      const canvas = document.createElement('canvas');
      canvas.width = 64;
      canvas.height = 64;
      const ctx = canvas.getContext('2d');
      if(!ctx) return new THREE.CanvasTexture(canvas);
      
      const grd = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
      grd.addColorStop(0, 'rgba(255, 255, 255, 1)');
      grd.addColorStop(0.2, 'rgba(255, 220, 100, 0.9)');
      grd.addColorStop(0.5, 'rgba(212, 175, 55, 0.4)');
      grd.addColorStop(1, 'rgba(0, 0, 0, 0)');
      
      ctx.fillStyle = grd;
      ctx.fillRect(0, 0, 64, 64);
      
      const tex = new THREE.CanvasTexture(canvas);
      tex.colorSpace = THREE.SRGBColorSpace;
      return tex;
    }

    function createTextTexture(text: string) {
      const canvas = document.createElement('canvas');
      canvas.width = 512;
      canvas.height = 512;
      const ctx = canvas.getContext('2d');
      if (!ctx) return new THREE.CanvasTexture(canvas);
      
      ctx.fillStyle = '#fceea7';
      ctx.fillRect(0, 0, 512, 512);
      ctx.strokeStyle = '#d4af37';
      ctx.lineWidth = 20;
      ctx.strokeRect(10, 10, 492, 492);
      ctx.fillStyle = '#000000';
      ctx.font = 'bold 60px "Cinzel"';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, 256, 256);
      
      const tex = new THREE.CanvasTexture(canvas);
      tex.colorSpace = THREE.SRGBColorSpace;
      return tex;
    }

    // --- Star Topper ---
    let starMesh: any = null;
    function createStar() {
        const shape = new THREE.Shape();
        const points = 5;
        const outerRadius = 2.5;
        const innerRadius = 1.2;
        
        for (let i = 0; i < points * 2; i++) {
            const angle = (i / (points * 2)) * Math.PI * 2;
            const radius = (i % 2 === 0) ? outerRadius : innerRadius;
            // Changed from -PI/2 to +PI/2 to make the tip point upwards
            const x = Math.cos(angle + Math.PI / 2) * radius; 
            const y = Math.sin(angle + Math.PI / 2) * radius;
            if (i === 0) shape.moveTo(x, y);
            else shape.lineTo(x, y);
        }
        shape.closePath();

        const extrudeSettings = {
            depth: 0.5,
            bevelEnabled: true,
            bevelThickness: 0.2,
            bevelSize: 0.1,
            bevelSegments: 3
        };

        const geometry = new THREE.ExtrudeGeometry(shape, extrudeSettings);
        geometry.center(); 
        
        const mat = new THREE.MeshStandardMaterial({
            color: 0xffd700,
            roughness: 0.1,
            metalness: 1.0,
            emissive: 0xffaa00,
            emissiveIntensity: 0.5
        });

        const mesh = new THREE.Mesh(geometry, mat);
        mesh.position.set(0, 16.5, 0); // Top of tree
        
        // Add a local light to the star
        const starLight = new THREE.PointLight(0xffaa00, 5, 15);
        starLight.position.set(0, 0, 2);
        mesh.add(starLight);

        mainGroup.add(mesh);
        starMesh = mesh;
    }
    createStar();

    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, -1, 0),
      new THREE.Vector3(0, 1, 0),
      new THREE.Vector3(0.5, 1.3, 0),
      new THREE.Vector3(0.8, 1.0, 0)
    ]);
    const candyGeo = new THREE.TubeGeometry(curve, 20, 0.1, 8, false);
    const candyMat = new THREE.MeshStandardMaterial({ map: createCandyCaneTexture(), roughness: 0.5, metalness: 0.1 });
    const boxGeo = new THREE.BoxGeometry(0.8, 0.8, 0.8);
    const sphereGeo = new THREE.SphereGeometry(0.5, 16, 16);

    class Particle {
      mesh: any;
      type: string;
      baseScale: number;
      speed: any;
      treePos: any;
      scatterPos: any;
      treeQuat: any;
      
      constructor(mesh: any, type = 'DECOR') {
        this.mesh = mesh;
        this.type = type;
        this.baseScale = mesh.scale.x;
        this.treeQuat = mesh.quaternion.clone();
        
        const randomOffset = Math.random() * Math.PI * 2;
        this.speed = new THREE.Vector3(
          (Math.random() - 0.5) * 0.1,
          (Math.random() - 0.5) * 0.1,
          (Math.random() - 0.5) * 0.1
        );

        // Tree Position
        const t = Math.random();
        const h = t * 30 - 15;
        const maxR = 12 * (1 - t) + 1;
        const angle = t * 50 * Math.PI + randomOffset;
        const r = Math.random() * maxR;
        this.treePos = new THREE.Vector3(Math.cos(angle) * r, h, Math.sin(angle) * r);

        // Scatter Position
        const phi = Math.acos(-1 + (2 * Math.random()));
        const theta = Math.sqrt(Math.PI * 2500) * phi;
        const rad = 8 + Math.random() * 12;
        this.scatterPos = new THREE.Vector3(
          rad * Math.cos(theta) * Math.sin(phi),
          rad * Math.sin(theta) * Math.sin(phi),
          rad * Math.cos(phi)
        );
      }

      update(dt: number, idx: number, camera: THREE.Camera, localFocusPos: any) {
        let tPos = this.treePos;
        let tScale = this.baseScale;

        if (STATE.mode === MODES.SCATTER) {
          tPos = this.scatterPos;
          this.mesh.rotation.x += this.speed.x;
          this.mesh.rotation.y += this.speed.y;
        } else if (STATE.mode === MODES.FOCUS) {
          if (this.type === 'PHOTO' && idx === STATE.targetPhotoIndex) {
            // Focus Mode
            tPos = localFocusPos;
            tScale = 1.35; 
            this.mesh.lookAt(camera.position);
          } else {
            tPos = this.scatterPos;
          }
        } else {
          // Tree Mode Sway
          if (this.type !== 'PHOTO') {
            this.mesh.rotation.y += 0.01;
          } else {
            // Restore proper surface orientation for photos in tree mode
            this.mesh.quaternion.slerp(this.treeQuat, 0.1);
          }
        }

        this.mesh.position.lerp(tPos, 0.05);
        this.mesh.scale.setScalar(THREE.MathUtils.lerp(this.mesh.scale.x, tScale, 0.05));

        if (STATE.mode !== MODES.SCATTER && !(STATE.mode === MODES.FOCUS && idx === STATE.targetPhotoIndex)) {
            if (this.type === 'PHOTO') {
                // Quaternion slerp handles stability
            } else {
                this.mesh.rotation.x *= 0.95;
                this.mesh.rotation.z *= 0.95;
            }
        }
      }
    }

    function addPhotoToScene(texture: any) {
      const aspect = texture.image ? texture.image.width / texture.image.height : 1;
      
      // Increased Base Size: 3.0 height (1.5x of previous standard)
      const baseH = 3.0;
      const baseW = baseH * aspect;
      const frameBorder = 0.2;

      const group = new THREE.Group();

      // 1. Frame (Back)
      const frameGeo = new THREE.BoxGeometry(baseW + frameBorder, baseH + frameBorder, 0.1);
      const frameMesh = new THREE.Mesh(frameGeo, goldMat);
      frameMesh.position.z = -0.06; 
      
      // 2. Photo (Front) - Using Standard Material to avoid burnout
      const photoGeo = new THREE.PlaneGeometry(baseW, baseH);
      const photoMat = new THREE.MeshStandardMaterial({ 
          map: texture, 
          side: THREE.DoubleSide,
          roughness: 0.6,
          metalness: 0.1
      });
      const photoMesh = new THREE.Mesh(photoGeo, photoMat);
      photoMesh.position.z = 0.06;

      group.add(frameMesh);
      group.add(photoMesh);
      mainGroup.add(group);

      const p = new Particle(group, 'PHOTO');
      
      // --- Spiral Calculation ---
      const index = STATE.photos.length;
      const heightStep = 1.2;
      const angleStep = 0.8; 
      
      let h = -12 + (index * heightStep);
      
      if (h > 15) {
         h = -12 + ((index * heightStep) % 27);
      }
      
      const coneHeight = 30; 
      const coneBaseY = -15;
      const t = (h - coneBaseY) / coneHeight; 
      const r = 12 * (1 - t) + 1; 
      
      const angle = index * angleStep;
      
      p.treePos.set(Math.cos(angle) * r, h, Math.sin(angle) * r);
      
      // Orientation: Face the center, Flip to face out, then Tilt back to match cone slope
      group.position.copy(p.treePos);
      group.lookAt(0, p.treePos.y, 0);
      group.rotateY(Math.PI);
      // Cone slope is approx delta R (12) / delta H (30).
      // We want to tilt local Z upwards, which is negative X rotation.
      group.rotateX(-Math.atan(12/30));
      
      // Save this orientation so we can restore it after scattering
      p.treeQuat.copy(group.quaternion);

      STATE.particles.push(p);
      STATE.photos.push(p);
    }

    // Init Particles
    addPhotoToScene(createTextTexture("JOYEUX NOEL"));

    for (let i = 0; i < 1500; i++) {
      let mesh;
      const rand = Math.random();
      if (rand < 0.4) {
        mesh = new THREE.Mesh(boxGeo, Math.random() > 0.5 ? goldMat : greenMat);
        mesh.scale.setScalar(0.4 + Math.random() * 0.4);
      } else if (rand < 0.8) {
        mesh = new THREE.Mesh(sphereGeo, Math.random() > 0.5 ? goldMat : redMat);
        mesh.scale.setScalar(0.4 + Math.random() * 0.4);
      } else {
        mesh = new THREE.Mesh(candyGeo, candyMat);
        mesh.scale.setScalar(0.6 + Math.random() * 0.4);
      }
      mainGroup.add(mesh);
      STATE.particles.push(new Particle(mesh, 'DECOR'));
    }

    // 1. Dust Particles
    const dustGeo = new THREE.BufferGeometry();
    const positions = [];
    for (let i = 0; i < 2500; i++) {
      const r = 25 * Math.cbrt(Math.random());
      const theta = Math.random() * 2 * Math.PI;
      const phi = Math.acos(2 * Math.random() - 1);
      positions.push(
        r * Math.sin(phi) * Math.cos(theta),
        r * Math.sin(phi) * Math.sin(theta),
        r * Math.cos(phi)
      );
    }
    dustGeo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    const dustMat = new THREE.PointsMaterial({ 
        color: 0xffd700, 
        size: 0.15, 
        transparent: true, 
        opacity: 0.6 
    });
    STATE.dust = new THREE.Points(dustGeo, dustMat);
    mainGroup.add(STATE.dust);

    // 2. Sparkle Halo Particles
    const sparkleGeo = new THREE.BufferGeometry();
    const sparkleCount = 400;
    const sparklePos = [];
    for(let i=0; i<sparkleCount; i++) {
        const t = Math.random();
        const h = t * 35 - 16; 
        const r = (14 * (1 - t) + 1) + (Math.random() - 0.5) * 6; 
        const angle = Math.random() * Math.PI * 2;
        sparklePos.push(Math.cos(angle) * r, h, Math.sin(angle) * r);
    }
    sparkleGeo.setAttribute('position', new THREE.Float32BufferAttribute(sparklePos, 3));
    const sparkleMat = new THREE.PointsMaterial({
        color: 0xffeebb,
        size: 0.8,
        map: createSparkleTexture(),
        transparent: true,
        opacity: 0.8,
        blending: THREE.AdditiveBlending,
        depthWrite: false
    });
    STATE.sparkles = new THREE.Points(sparkleGeo, sparkleMat);
    mainGroup.add(STATE.sparkles);


    // --- 4. MediaPipe ---
    let handLandmarker: any = undefined;
    let lastVideoTime = -1;
    let animationId: number;

    const initCV = async () => {
      try {
        const vision = await FilesetResolver.forVisionTasks(
          "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3/wasm"
        );
        handLandmarker = await HandLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: `https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task`,
            delegate: "GPU"
          },
          runningMode: "VIDEO",
          numHands: 1
        });

        if (videoRef.current) {
          const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 320, height: 240 } });
          videoRef.current.srcObject = stream;
          videoRef.current.addEventListener("loadeddata", predictWebcam);
        }

        const loader = document.getElementById('loader');
        if (loader) {
            loader.style.opacity = '0';
            setTimeout(() => loader.remove(), 1000);
        }
      } catch (e) {
        console.error("CV Init Failed:", e);
        const loader = document.getElementById('loader');
        if (loader) {
            loader.style.opacity = '0';
            setTimeout(() => loader.remove(), 1000);
        }
      }
    };

    function detectGestures(landmarks: any) {
        const thumb = landmarks[4];
        const index = landmarks[8];
        const mid = landmarks[12];
        const wrist = landmarks[0];
        const tips = [landmarks[8], landmarks[12], landmarks[16], landmarks[20]];

        // Pinch dist
        const pinchDist = Math.hypot(thumb.x - index.x, thumb.y - index.y, thumb.z - index.z);
        const midDist = Math.hypot(mid.x - wrist.x, mid.y - wrist.y, mid.z - wrist.z);
        
        let avgDist = 0;
        tips.forEach(t => avgDist += Math.hypot(t.x - wrist.x, t.y - wrist.y, t.z - wrist.z));
        avgDist /= 4;

        if (pinchDist < 0.1 && midDist > 0.25) {
            if (STATE.mode !== MODES.FOCUS) {
                STATE.mode = MODES.FOCUS;
                if (STATE.photos.length > 0) {
                    const r = Math.floor(Math.random() * STATE.photos.length);
                    STATE.targetPhotoIndex = STATE.particles.indexOf(STATE.photos[r]);
                }
            }
        } else if (avgDist < 0.25) {
            STATE.mode = MODES.TREE;
        } else if (avgDist > 0.4) {
            STATE.mode = MODES.SCATTER;
        }

        const palm = landmarks[9];
        const nx = (1 - palm.x - 0.5); 
        const ny = (palm.y - 0.5);
        
        STATE.handPos.x = THREE.MathUtils.lerp(STATE.handPos.x, nx, 0.1);
        STATE.handPos.y = THREE.MathUtils.lerp(STATE.handPos.y, ny, 0.1);
    }

    async function predictWebcam() {
        if (handLandmarker && videoRef.current && videoRef.current.currentTime !== lastVideoTime) {
            lastVideoTime = videoRef.current.currentTime;
            const startTimeMs = performance.now();
            const result = handLandmarker.detectForVideo(videoRef.current, startTimeMs);

            if (result.landmarks && result.landmarks.length > 0) {
                detectGestures(result.landmarks[0]);
                
                if (cvCanvasRef.current) {
                    const ctx = cvCanvasRef.current.getContext('2d');
                    if (ctx) {
                        ctx.clearRect(0,0, 320, 240);
                        ctx.fillStyle = 'red';
                        for(const p of result.landmarks[0]) {
                            ctx.fillRect(p.x * 320, p.y * 240, 4, 4);
                        }
                    }
                }
            }
        }
        if (mountRef.current) { 
            requestAnimationFrame(predictWebcam);
        }
    }

    // --- 5. Animation Loop ---
    const clock = new THREE.Clock();

    const animate = () => {
      animationId = requestAnimationFrame(animate);
      const dt = clock.getDelta();
      
      const targetRotY = STATE.handPos.x * Math.PI; 
      const targetRotX = STATE.handPos.y * Math.PI * 0.5;

      mainGroup.rotation.y = THREE.MathUtils.lerp(mainGroup.rotation.y, targetRotY, 0.05);
      mainGroup.rotation.x = THREE.MathUtils.lerp(mainGroup.rotation.x, targetRotX, 0.05);

      // Rotate Star independently
      if (starMesh) {
          starMesh.rotation.y -= 0.01;
      }

      // --- Calculate Local Position for Centering ---
      const worldFocusPos = new THREE.Vector3(0, 2, 42);
      mainGroup.updateMatrixWorld(); 
      const invModelMatrix = mainGroup.matrixWorld.clone().invert();
      const localFocusPos = worldFocusPos.applyMatrix4(invModelMatrix);

      STATE.particles.forEach((p, i) => p.update(dt, i, camera, localFocusPos));

      if (STATE.dust) STATE.dust.rotation.y += 0.005;
      if (STATE.sparkles) {
          STATE.sparkles.rotation.y -= 0.002; 
          const time = clock.getElapsedTime();
          STATE.sparkles.material.size = 0.8 + Math.sin(time * 2) * 0.2;
      }

      composer.render();
    };

    animate();
    initCV();

    const handleResize = () => {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
      composer.setSize(window.innerWidth, window.innerHeight);
    };
    window.addEventListener('resize', handleResize);

    const handleKeyDown = (e: KeyboardEvent) => {
        if (e.key.toLowerCase() === 'h') {
            const title = document.getElementById('main-title');
            const controls = document.querySelector('.upload-wrapper');
            const signature = document.getElementById('footer-signature');
            title?.classList.toggle('ui-hidden');
            controls?.classList.toggle('ui-hidden');
            signature?.classList.toggle('ui-hidden');
        }
    };
    window.addEventListener('keydown', handleKeyDown);

    const handleFileChange = (e: Event) => {
        const target = e.target as HTMLInputElement;
        const files = target.files;
        if(!files || files.length === 0) return;

        Array.from(files).forEach(f => {
            const reader = new FileReader();
            reader.onload = (ev) => {
                new THREE.TextureLoader().load(ev.target?.result as string, (t: any) => {
                    t.colorSpace = THREE.SRGBColorSpace; 
                    addPhotoToScene(t);
                });
            }
            reader.readAsDataURL(f);
        });
    };

    if (fileInputRef.current) {
        fileInputRef.current.addEventListener('change', handleFileChange);
    }

    return () => {
      cancelAnimationFrame(animationId);
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('keydown', handleKeyDown);
      if (mountRef.current) {
        mountRef.current.removeChild(renderer.domElement);
      }
      renderer.dispose();
    };
  }, []);

  return (
    <>
      <div id="loader">
        <div className="spinner"></div>
        <div className="loading-text">LOADING HOLIDAY MAGIC</div>
      </div>

      <h1 id="main-title">Merry Christmas</h1>
      <div id="footer-signature">LSY&WSR</div>

      <div className="upload-wrapper">
          <input ref={fileInputRef} type="file" id="file-input" accept="image/*" multiple style={{display: 'none'}} />
          <button className="btn-upload" onClick={() => fileInputRef.current?.click()}>ADD MEMORIES</button>
          <span className="hint-text">Press 'H' to Hide Controls</span>
      </div>

      <div className="webcam-container">
          <video ref={videoRef} id="webcam" autoPlay playsInline></video>
          <canvas ref={cvCanvasRef} id="cv_canvas" width="320" height="240"></canvas>
      </div>

      <div ref={mountRef} style={{ width: '100vw', height: '100vh' }} />
    </>
  );
};

const container = document.getElementById('root');
const root = createRoot(container!);
root.render(<App />);