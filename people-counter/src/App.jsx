import { useEffect, useRef, useState, useCallback } from "react";
import { Link } from "react-router-dom";
import {
  PoseLandmarker,
  FilesetResolver,
  DrawingUtils,
} from "@mediapipe/tasks-vision";

// Configuration de l'API Backend - détection automatique en production
const getApiBaseUrl = () => {
  // Si une variable d'environnement est définie, l'utiliser
  if (import.meta.env.VITE_API_URL) {
    return import.meta.env.VITE_API_URL;
  }
  // En production, utiliser l'URL actuelle du navigateur
  if (import.meta.env.PROD) {
    return `${window.location.origin}/api`;
  }
  // En développement, utiliser localhost
  return "http://localhost:5500/api";
};

const API_BASE_URL = getApiBaseUrl();

// Connexions du squelette pour le dessin
const POSE_CONNECTIONS = [
  [11, 12], // épaules
  [11, 13],
  [13, 15], // bras gauche
  [12, 14],
  [14, 16], // bras droit
  [11, 23],
  [12, 24], // torse
  [23, 24], // hanches
  [23, 25],
  [25, 27], // jambe gauche
  [24, 26],
  [26, 28], // jambe droite
  [0, 1],
  [1, 2],
  [2, 3],
  [3, 7], // visage gauche
  [0, 4],
  [4, 5],
  [5, 6],
  [6, 8], // visage droit
  [9, 10], // bouche
];

function App() {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const [entrances, setEntrances] = useState(0);
  const [exits, setExits] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [cameraReady, setCameraReady] = useState(false);
  const [detectedPeople, setDetectedPeople] = useState(0);
  const [trackingMode, setTrackingMode] = useState("torso"); // 'bbox', 'skeleton', 'torso'
  const [apiConnected, setApiConnected] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const trackingModeRef = useRef(trackingMode);

  // Refs pour éviter les appels API en double
  const lastSyncedEntrances = useRef(0);
  const lastSyncedExits = useRef(0);
  const syncTimeoutRef = useRef(null);

  // Mettre à jour le ref quand trackingMode change
  useEffect(() => {
    trackingModeRef.current = trackingMode;
  }, [trackingMode]);

  // Fonction pour synchroniser avec l'API
  const syncWithApi = useCallback(async (newEntrances, newExits) => {
    if (syncTimeoutRef.current) {
      clearTimeout(syncTimeoutRef.current);
    }

    syncTimeoutRef.current = setTimeout(async () => {
      if (
        newEntrances === lastSyncedEntrances.current &&
        newExits === lastSyncedExits.current
      ) {
        return;
      }

      try {
        const response = await fetch(`${API_BASE_URL}/counter`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ entrances: newEntrances, exits: newExits }),
        });

        if (response.ok) {
          lastSyncedEntrances.current = newEntrances;
          lastSyncedExits.current = newExits;
        }
      } catch (err) {
        console.error("Erreur sync API:", err);
      }
    }, 500); // Debounce de 500ms
  }, []);

  // Charger les données initiales depuis l'API
  useEffect(() => {
    const loadInitialData = async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/counter`);
        if (response.ok) {
          const result = await response.json();
          if (result.success && result.data) {
            setEntrances(result.data.entrances);
            setExits(result.data.exits);
            lastSyncedEntrances.current = result.data.entrances;
            lastSyncedExits.current = result.data.exits;
          }
          setApiConnected(true);
        }
      } catch (err) {
        console.warn("API non disponible, mode local activé:", err.message);
        setApiConnected(false);
      }
    };

    loadInitialData();
  }, []);

  // Synchroniser les compteurs avec l'API quand ils changent
  useEffect(() => {
    if (apiConnected) {
      syncWithApi(entrances, exits);
    }
  }, [entrances, exits, apiConnected, syncWithApi]);

  // Tracking des personnes
  const trackedPeopleRef = useRef(new Map());
  const poseLandmarkerRef = useRef(null);
  const animationFrameRef = useRef(null);
  const lastVideoTimeRef = useRef(-1);

  // Initialisation de MediaPipe et de la webcam
  useEffect(() => {
    let stream = null;
    let isActive = true;

    const initCamera = async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            width: { ideal: 1280 },
            height: { ideal: 720 },
            facingMode: "user",
          },
        });

        if (videoRef.current && isActive) {
          videoRef.current.srcObject = stream;
          videoRef.current.onloadedmetadata = () => {
            videoRef.current.play();
            setCameraReady(true);
            startRendering();
          };
        }
      } catch (err) {
        setError(
          "Impossible d'accéder à la caméra. Veuillez autoriser l'accès.",
        );
        setIsLoading(false);
      }
    };

    const startRendering = () => {
      const render = () => {
        if (!isActive) return;

        const video = videoRef.current;
        const canvas = canvasRef.current;

        if (video && canvas && video.readyState >= 2) {
          const ctx = canvas.getContext("2d");
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;

          // Dessiner la vidéo
          ctx.drawImage(video, 0, 0);

          // Position de la ligne de comptage (au milieu)
          const lineX = canvas.width / 2;

          // Dessiner la ligne de comptage
          ctx.strokeStyle = "#FFD700";
          ctx.lineWidth = 4;
          ctx.setLineDash([15, 15]);
          ctx.beginPath();
          ctx.moveTo(lineX, 0);
          ctx.lineTo(lineX, canvas.height);
          ctx.stroke();
          ctx.setLineDash([]);

          // Zone de texte pour la ligne
          ctx.fillStyle = "rgba(255, 215, 0, 0.8)";
          ctx.fillRect(lineX - 60, 10, 120, 30);
          ctx.fillStyle = "#000";
          ctx.font = "bold 14px Arial";
          ctx.textAlign = "center";
          ctx.fillText("LIGNE DE COMPTAGE", lineX, 30);

          // === LÉGENDE en haut à gauche ===
          const legendX = 15;
          const legendY = 60;
          const legendPadding = 10;
          const lineHeight = 22;

          // Fond de la légende
          ctx.fillStyle = "rgba(0, 0, 0, 0.7)";
          ctx.fillRect(legendX, legendY, 180, 85);
          ctx.strokeStyle = "#ff6b35";
          ctx.lineWidth = 2;
          ctx.strokeRect(legendX, legendY, 180, 85);

          ctx.font = "bold 11px monospace";
          ctx.textAlign = "left";

          // Point rouge = brut
          ctx.fillStyle = "#ff3333";
          ctx.beginPath();
          ctx.arc(legendX + legendPadding + 6, legendY + 20, 6, 0, 2 * Math.PI);
          ctx.fill();
          ctx.fillStyle = "#ffffff";
          ctx.fillText(
            "Position brute",
            legendX + legendPadding + 20,
            legendY + 24,
          );

          // Point vert = lissé
          ctx.fillStyle = "#00ff88";
          ctx.beginPath();
          ctx.arc(
            legendX + legendPadding + 6,
            legendY + 20 + lineHeight,
            8,
            0,
            2 * Math.PI,
          );
          ctx.fill();
          ctx.strokeStyle = "#ffffff";
          ctx.lineWidth = 2;
          ctx.stroke();
          ctx.fillStyle = "#ffffff";
          ctx.fillText(
            "Position lissée",
            legendX + legendPadding + 20,
            legendY + 24 + lineHeight,
          );

          // Ligne jaune = lien
          ctx.strokeStyle = "#ffcc00";
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.moveTo(legendX + legendPadding, legendY + 20 + lineHeight * 2);
          ctx.lineTo(
            legendX + legendPadding + 12,
            legendY + 20 + lineHeight * 2,
          );
          ctx.stroke();
          ctx.fillStyle = "#ffffff";
          ctx.fillText(
            "Écart brut/lissé",
            legendX + legendPadding + 20,
            legendY + 24 + lineHeight * 2,
          );

          // Si le détecteur est prêt, faire la détection
          if (
            poseLandmarkerRef.current &&
            video.currentTime !== lastVideoTimeRef.current
          ) {
            lastVideoTimeRef.current = video.currentTime;

            try {
              const results = poseLandmarkerRef.current.detectForVideo(
                video,
                performance.now(),
              );
              processPoseResults(
                results,
                ctx,
                lineX,
                canvas.width,
                canvas.height,
              );
            } catch (err) {
              console.error("Erreur de détection:", err);
            }
          }
        }

        animationFrameRef.current = requestAnimationFrame(render);
      };

      render();
    };

    const initPoseLandmarker = async () => {
      try {
        const vision = await FilesetResolver.forVisionTasks(
          "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm",
        );

        poseLandmarkerRef.current = await PoseLandmarker.createFromOptions(
          vision,
          {
            baseOptions: {
              modelAssetPath:
                "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task",
              delegate: "GPU",
            },
            runningMode: "VIDEO",
            numPoses: 5, // Détecter jusqu'à 5 personnes
            minPoseDetectionConfidence: 0.5,
            minPosePresenceConfidence: 0.5,
            minTrackingConfidence: 0.5,
          },
        );

        setIsLoading(false);
      } catch (err) {
        console.error("Erreur d'initialisation du PoseLandmarker:", err);
        setError("Erreur lors du chargement du modèle de détection");
        setIsLoading(false);
      }
    };

    initCamera();
    initPoseLandmarker();

    return () => {
      isActive = false;
      if (stream) {
        stream.getTracks().forEach((track) => track.stop());
      }
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, []);

  // Fonction pour calculer la distance entre deux points
  const getDistance = (p1, p2) => {
    return Math.sqrt(Math.pow(p1.x - p2.x, 2) + Math.pow(p1.y - p2.y, 2));
  };

  // Dessiner le squelette complet
  const drawSkeleton = (landmarks, ctx, width, height, color) => {
    // Dessiner les connexions
    ctx.strokeStyle = color;
    ctx.lineWidth = 3;

    POSE_CONNECTIONS.forEach(([start, end]) => {
      const startPoint = landmarks[start];
      const endPoint = landmarks[end];

      if (
        startPoint &&
        endPoint &&
        startPoint.visibility > 0.5 &&
        endPoint.visibility > 0.5
      ) {
        ctx.beginPath();
        ctx.moveTo(startPoint.x * width, startPoint.y * height);
        ctx.lineTo(endPoint.x * width, endPoint.y * height);
        ctx.stroke();
      }
    });

    // Dessiner les points
    landmarks.forEach((landmark, index) => {
      if (landmark.visibility > 0.5) {
        const x = landmark.x * width;
        const y = landmark.y * height;

        // Points plus gros pour les articulations principales
        const isMainJoint = [
          11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28,
        ].includes(index);
        const radius = isMainJoint ? 6 : 4;

        ctx.fillStyle = isMainJoint ? "#FF0000" : "#00FFFF";
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, 2 * Math.PI);
        ctx.fill();

        ctx.strokeStyle = "#000";
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    });
  };

  // Dessiner uniquement le tronc (épaules + hanches)
  const drawTorso = (landmarks, ctx, width, height, color) => {
    const torsoConnections = [
      [11, 12], // épaules
      [11, 23], // côté gauche
      [12, 24], // côté droit
      [23, 24], // hanches
    ];
    const torsoPoints = [11, 12, 23, 24]; // épaules et hanches

    ctx.strokeStyle = color;
    ctx.lineWidth = 4;

    // Dessiner les connexions du tronc
    torsoConnections.forEach(([start, end]) => {
      const startPoint = landmarks[start];
      const endPoint = landmarks[end];

      if (
        startPoint &&
        endPoint &&
        startPoint.visibility > 0.5 &&
        endPoint.visibility > 0.5
      ) {
        ctx.beginPath();
        ctx.moveTo(startPoint.x * width, startPoint.y * height);
        ctx.lineTo(endPoint.x * width, endPoint.y * height);
        ctx.stroke();
      }
    });

    // Dessiner les 4 points du tronc
    torsoPoints.forEach((index) => {
      const landmark = landmarks[index];
      if (landmark && landmark.visibility > 0.5) {
        const x = landmark.x * width;
        const y = landmark.y * height;

        ctx.fillStyle = "#FF0000";
        ctx.beginPath();
        ctx.arc(x, y, 8, 0, 2 * Math.PI);
        ctx.fill();

        ctx.strokeStyle = "#000";
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    });
  };

  // Traitement des résultats de pose
  const processPoseResults = (results, ctx, lineX, width, height) => {
    const currentPeople = new Map();
    const threshold = 0.15; // Distance normalisée

    setDetectedPeople(results.landmarks.length);

    const colors = ["#00FF00", "#FF00FF", "#00FFFF", "#FFFF00", "#FF8800"];

    results.landmarks.forEach((landmarks, index) => {
      const color = colors[index % colors.length];
      const currentMode = trackingModeRef.current;

      // Dessiner selon le mode de tracking
      if (currentMode === "skeleton") {
        drawSkeleton(landmarks, ctx, width, height, color);
      } else if (currentMode === "torso") {
        drawTorso(landmarks, ctx, width, height, color);
      }
      // En mode "bbox", on ne dessine que la boîte (fait plus bas)

      // Calculer le centre selon le mode de tracking
      let center = null;
      let screenX = 0;
      let screenY = 0;
      let bbox = null;

      if (currentMode === "torso") {
        // Mode Tronc: utilise le centre des hanches
        const leftHip = landmarks[23];
        const rightHip = landmarks[24];
        if (
          leftHip &&
          rightHip &&
          leftHip.visibility > 0.5 &&
          rightHip.visibility > 0.5
        ) {
          const centerX = (leftHip.x + rightHip.x) / 2;
          const centerY = (leftHip.y + rightHip.y) / 2;
          center = { x: centerX, y: centerY };
          screenX = centerX * width;
          screenY = centerY * height;
        }
      } else if (currentMode === "skeleton") {
        // Mode Squelette: utilise le centre de tous les points visibles
        const visibleLandmarks = landmarks.filter((l) => l.visibility > 0.5);
        if (visibleLandmarks.length > 0) {
          const sumX = visibleLandmarks.reduce((acc, l) => acc + l.x, 0);
          const sumY = visibleLandmarks.reduce((acc, l) => acc + l.y, 0);
          const centerX = sumX / visibleLandmarks.length;
          const centerY = sumY / visibleLandmarks.length;
          center = { x: centerX, y: centerY };
          screenX = centerX * width;
          screenY = centerY * height;
        }
      } else if (currentMode === "bbox") {
        // Mode Bounding Box: calcule une boîte englobante
        const visibleLandmarks = landmarks.filter((l) => l.visibility > 0.5);
        if (visibleLandmarks.length > 0) {
          const minX = Math.min(...visibleLandmarks.map((l) => l.x));
          const maxX = Math.max(...visibleLandmarks.map((l) => l.x));
          const minY = Math.min(...visibleLandmarks.map((l) => l.y));
          const maxY = Math.max(...visibleLandmarks.map((l) => l.y));

          const centerX = (minX + maxX) / 2;
          const centerY = (minY + maxY) / 2;
          center = { x: centerX, y: centerY };
          screenX = centerX * width;
          screenY = centerY * height;

          // Stocker la bounding box pour le dessin
          bbox = {
            x: minX * width,
            y: minY * height,
            width: (maxX - minX) * width,
            height: (maxY - minY) * height,
          };

          // Dessiner la bounding box avec un fond semi-transparent
          ctx.fillStyle = `${color}20`; // Couleur avec 20% d'opacité
          ctx.fillRect(bbox.x, bbox.y, bbox.width, bbox.height);

          ctx.strokeStyle = color;
          ctx.lineWidth = 3;
          ctx.strokeRect(bbox.x, bbox.y, bbox.width, bbox.height);

          // Afficher "Personne" au-dessus de la box avec un fond
          const label = `Personne ${index + 1}`;
          ctx.font = "bold 14px Arial";
          const textWidth = ctx.measureText(label).width;
          ctx.fillStyle = color;
          ctx.fillRect(bbox.x, bbox.y - 22, textWidth + 10, 20);
          ctx.fillStyle = "#000";
          ctx.textAlign = "left";
          ctx.fillText(label, bbox.x + 5, bbox.y - 7);
        }
      }

      if (center) {
        // Chercher la personne la plus proche dans le tracking précédent
        let matchedId = null;
        let minDist = threshold;

        trackedPeopleRef.current.forEach((person, id) => {
          const dist = getDistance(center, person.center);
          if (dist < minDist) {
            minDist = dist;
            matchedId = id;
          }
        });

        // Position X normalisée de la ligne
        const normalizedLineX = lineX / width;

        // Calculer la position lissée
        let smoothedCenter = center;

        if (matchedId !== null) {
          const prevPerson = trackedPeopleRef.current.get(matchedId);

          // Lissage de la position (smoothing) - on garde 70% de l'ancienne position + 30% de la nouvelle
          const smoothingFactor = 0.3;
          smoothedCenter = {
            x:
              prevPerson.center.x * (1 - smoothingFactor) +
              center.x * smoothingFactor,
            y:
              prevPerson.center.y * (1 - smoothingFactor) +
              center.y * smoothingFactor,
          };

          // Vérifier le passage de la ligne avec la position lissée
          if (!prevPerson.counted) {
            // Passage de gauche à droite = Entrée
            if (
              prevPerson.center.x < normalizedLineX &&
              smoothedCenter.x >= normalizedLineX
            ) {
              console.log(
                `🚶 ENTRÉE détectée ! (${new Date().toLocaleTimeString()})`,
              );
              setEntrances((prev) => prev + 1);
              prevPerson.counted = true;
              // Enregistrer dans l'historique
              fetch(`${API_BASE_URL}/counter/increment`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ type: "entrance" })
              }).catch(err => console.error("Erreur enregistrement entrée:", err));
            }
            // Passage de droite à gauche = Sortie
            else if (
              prevPerson.center.x > normalizedLineX &&
              smoothedCenter.x <= normalizedLineX
            ) {
              console.log(
                `🚪 SORTIE détectée ! (${new Date().toLocaleTimeString()})`,
              );
              setExits((prev) => prev + 1);
              prevPerson.counted = true;
              // Enregistrer dans l'historique
              fetch(`${API_BASE_URL}/counter/increment`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ type: "exit" })
              }).catch(err => console.error("Erreur enregistrement sortie:", err));
            }
          }

          currentPeople.set(matchedId, {
            center: smoothedCenter, // On stocke la position lissée
            counted: prevPerson.counted,
            lastSeen: Date.now(),
          });
        } else {
          // Nouvelle personne
          const newId = `person_${Date.now()}_${index}`;
          currentPeople.set(newId, {
            center,
            counted: false,
            lastSeen: Date.now(),
          });
        }

        // Coordonnées écran pour le point lissé
        const smoothedScreenX = smoothedCenter.x * width;
        const smoothedScreenY = smoothedCenter.y * height;

        // === VISUALISATION ===

        // 1. Point BRUT (position directe MediaPipe) - petit cercle rouge
        ctx.fillStyle = "rgba(255, 50, 50, 0.7)";
        ctx.beginPath();
        ctx.arc(screenX, screenY, 6, 0, 2 * Math.PI);
        ctx.fill();
        ctx.strokeStyle = "#ff0000";
        ctx.lineWidth = 2;
        ctx.stroke();

        // 2. Ligne fantôme entre point brut et point lissé
        ctx.strokeStyle = "#ffcc00";
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(screenX, screenY);
        ctx.lineTo(smoothedScreenX, smoothedScreenY);
        ctx.stroke();

        // 3. Point LISSÉ (stabilisé) - gros cercle blanc/vert
        ctx.fillStyle = "#00ff88";
        ctx.beginPath();
        ctx.arc(smoothedScreenX, smoothedScreenY, 10, 0, 2 * Math.PI);
        ctx.fill();
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 3;
        ctx.stroke();

        // 4. Ligne verticale pour la position X lissée
        ctx.strokeStyle = "rgba(0, 255, 136, 0.3)";
        ctx.lineWidth = 1;
        ctx.setLineDash([5, 5]);
        ctx.beginPath();
        ctx.moveTo(smoothedScreenX, 0);
        ctx.lineTo(smoothedScreenX, height);
        ctx.stroke();
        ctx.setLineDash([]);

        // Afficher l'ID de la personne (sauf en mode bbox où c'est déjà fait)
        if (currentMode !== "bbox") {
          ctx.fillStyle = color;
          ctx.font = "bold 16px Arial";
          ctx.textAlign = "center";
          ctx.fillText(
            `Personne ${index + 1}`,
            smoothedScreenX,
            smoothedScreenY - 20,
          );
        }
      }
    });

    trackedPeopleRef.current = currentPeople;
  };

  // Reset des compteurs
  const handleReset = async () => {
    setIsSyncing(true);

    // Reset local
    setEntrances(0);
    setExits(0);
    trackedPeopleRef.current = new Map();
    lastSyncedEntrances.current = 0;
    lastSyncedExits.current = 0;

    // Reset sur l'API
    if (apiConnected) {
      try {
        await fetch(`${API_BASE_URL}/counter/reset`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
        });
      } catch (err) {
        console.error("Erreur reset API:", err);
      }
    }

    setIsSyncing(false);
  };

  const totalInside = entrances - exits;

  return (
    <div className="h-screen overflow-hidden bg-[#0a0a0a] text-[#e0e0e0] flex flex-col font-mono">
      {/* Header minimaliste */}
      <header className="bg-[#111] border-b-2 border-[#ff6b35] px-4 py-2 flex-shrink-0">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <div className="w-2 h-8 bg-[#ff6b35]"></div>
            <h1 className="text-lg font-bold tracking-wider uppercase text-white">
              People Counter
            </h1>
            <div
              className={`w-2 h-2 rounded-full ${apiConnected ? "bg-[#00ff88]" : "bg-[#ffaa00]"}`}
            ></div>
          </div>

          {/* Sélecteur de mode */}
          <div className="flex items-center gap-1 bg-[#1a1a1a] p-1">
            <button
              onClick={() => setTrackingMode("bbox")}
              className={`px-3 py-1 text-xs uppercase tracking-wide transition-all ${
                trackingMode === "bbox"
                  ? "bg-[#ff6b35] text-black font-bold"
                  : "text-[#888] hover:text-white hover:bg-[#222]"
              }`}
            >
              Box
            </button>
            <button
              onClick={() => setTrackingMode("skeleton")}
              className={`px-3 py-1 text-xs uppercase tracking-wide transition-all ${
                trackingMode === "skeleton"
                  ? "bg-[#ff6b35] text-black font-bold"
                  : "text-[#888] hover:text-white hover:bg-[#222]"
              }`}
            >
              Skeleton
            </button>
            <button
              onClick={() => setTrackingMode("torso")}
              className={`px-3 py-1 text-xs uppercase tracking-wide transition-all ${
                trackingMode === "torso"
                  ? "bg-[#ff6b35] text-black font-bold"
                  : "text-[#888] hover:text-white hover:bg-[#222]"
              }`}
            >
              Torse
            </button>
          </div>

          <button
            onClick={handleReset}
            disabled={isSyncing}
            className={`px-4 py-1.5 text-xs uppercase tracking-wide border-2 transition-all ${
              isSyncing
                ? "border-[#333] text-[#555] cursor-not-allowed"
                : "border-[#ff6b35] text-[#ff6b35] hover:bg-[#ff6b35] hover:text-black"
            }`}
          >
            {isSyncing ? "..." : "Reset"}
          </button>

          <Link
            to="/stats"
            className="px-4 py-1.5 text-xs uppercase tracking-wide border-2 border-[#00aaff] text-[#00aaff] hover:bg-[#00aaff] hover:text-black transition-all"
          >
            Stats →
          </Link>
        </div>
      </header>

      <main className="flex-1 overflow-hidden relative">
        {/* Zone vidéo */}
        <div className="relative h-full bg-black">
          {isLoading && (
            <div className="absolute inset-0 flex items-center justify-center bg-black z-10">
              <div className="text-center">
                <div className="w-12 h-12 border-2 border-[#ff6b35] border-t-transparent animate-spin mx-auto mb-4"></div>
                <p className="text-xs uppercase tracking-widest text-[#666]">
                  Initialisation...
                </p>
              </div>
            </div>
          )}

          {error && (
            <div className="absolutftore inset-0 flex items-center justify-center bg-black z-10">
              <div className="text-center p-8 border border-[#ff3333] bg-[#111]">
                <p className="text-[#ff3333] text-sm uppercase tracking-wide">
                  {error}
                </p>
              </div>
            </div>
          )}

          <video ref={videoRef} autoPlay playsInline muted className="hidden" />

          <canvas ref={canvasRef} className="w-full h-full object-contain" />

          {/* Compteurs en overlay - style HUD */}
          {!isLoading && !error && (
            <div className="absolute bottom-0 left-0 right-0 p-3">
              <div className="flex justify-center gap-2">
                {/* Détectées */}
                <div className="bg-black/70 border-l-4 border-[#ff6b35] px-4 py-2 min-w-[120px]">
                  <div className="text-[10px] uppercase tracking-widest text-[#ff6b35] mb-1">
                    Détectées
                  </div>
                  <div className="text-2xl font-bold text-white tabular-nums">
                    {detectedPeople}
                  </div>
                </div>

                {/* Entrées */}
                <div className="bg-black/70 border-l-4 border-[#00ff88] px-4 py-2 min-w-[120px]">
                  <div className="text-[10px] uppercase tracking-widest text-[#00ff88] mb-1">
                    Entrées
                  </div>
                  <div className="text-2xl font-bold text-white tabular-nums">
                    {entrances}
                  </div>
                </div>

                {/* À l'intérieur */}
                <div className="bg-black/70 border-l-4 border-[#00aaff] px-4 py-2 min-w-[120px]">
                  <div className="text-[10px] uppercase tracking-widest text-[#00aaff] mb-1">
                    Intérieur
                  </div>
                  <div className="text-2xl font-bold text-white tabular-nums">
                    {totalInside}
                  </div>
                </div>

                {/* Sorties */}
                <div className="bg-black/70 border-l-4 border-[#ff3366] px-4 py-2 min-w-[120px]">
                  <div className="text-[10px] uppercase tracking-widest text-[#ff3366] mb-1">
                    Sorties
                  </div>
                  <div className="text-2xl font-bold text-white tabular-nums">
                    {exits}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

export default App;
