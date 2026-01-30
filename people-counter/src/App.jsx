import { useEffect, useRef, useState, useCallback } from "react";
import {
  PoseLandmarker,
  FilesetResolver,
  DrawingUtils,
} from "@mediapipe/tasks-vision";

// Configuration de l'API Backend
const API_BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:5500/api";

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
      if (newEntrances === lastSyncedEntrances.current && newExits === lastSyncedExits.current) {
        return;
      }
      
      try {
        const response = await fetch(`${API_BASE_URL}/counter`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ entrances: newEntrances, exits: newExits })
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
        // Dessiner le centre du corps (point de tracking)
        ctx.fillStyle = "#FFFFFF";
        ctx.beginPath();
        ctx.arc(screenX, screenY, 10, 0, 2 * Math.PI);
        ctx.fill();
        ctx.strokeStyle = color;
        ctx.lineWidth = 3;
        ctx.stroke();

        // Dessiner une ligne horizontale pour montrer la position X
        ctx.strokeStyle = "rgba(255, 255, 255, 0.5)";
        ctx.lineWidth = 1;
        ctx.setLineDash([5, 5]);
        ctx.beginPath();
        ctx.moveTo(screenX, 0);
        ctx.lineTo(screenX, height);
        ctx.stroke();
        ctx.setLineDash([]);

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

        if (matchedId !== null) {
          const prevPerson = trackedPeopleRef.current.get(matchedId);

          // Vérifier le passage de la ligne
          if (!prevPerson.counted) {
            // Passage de gauche à droite = Entrée
            if (
              prevPerson.center.x < normalizedLineX &&
              center.x >= normalizedLineX
            ) {
              setEntrances((prev) => prev + 1);
              prevPerson.counted = true;
            }
            // Passage de droite à gauche = Sortie
            else if (
              prevPerson.center.x > normalizedLineX &&
              center.x <= normalizedLineX
            ) {
              setExits((prev) => prev + 1);
              prevPerson.counted = true;
            }
          }

          currentPeople.set(matchedId, {
            center,
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

        // Afficher l'ID de la personne (sauf en mode bbox où c'est déjà fait)
        if (currentMode !== "bbox") {
          ctx.fillStyle = color;
          ctx.font = "bold 16px Arial";
          ctx.textAlign = "center";
          ctx.fillText(`Personne ${index + 1}`, screenX, screenY - 20);
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
          headers: { "Content-Type": "application/json" }
        });
      } catch (err) {
        console.error("Erreur reset API:", err);
      }
    }
    
    setIsSyncing(false);
  };

  const totalInside = entrances - exits;

  return (
    <div className="h-screen overflow-hidden bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 text-white flex flex-col">
      {/* Header compact */}
      <header className="bg-gray-800/50 backdrop-blur-sm border-b border-gray-700 p-2 flex-shrink-0">
        <div className="container mx-auto flex items-center justify-between flex-wrap gap-2">
          <h1 className="text-xl font-bold bg-gradient-to-r from-blue-400 to-purple-500 bg-clip-text text-transparent">
            🚶 Compteur de Personnes
          </h1>

          {/* Sélecteur de mode de tracking */}
          <div className="flex items-center gap-2 bg-gray-700/50 rounded-lg p-1">
            <span className="text-sm text-gray-400 px-2">Mode:</span>
            <button
              onClick={() => setTrackingMode("bbox")}
              className={`px-3 py-1.5 rounded-md text-sm font-medium transition-all ${
                trackingMode === "bbox"
                  ? "bg-blue-600 text-white"
                  : "text-gray-300 hover:bg-gray-600"
              }`}
            >
              🟦 Boîte
            </button>
            <button
              onClick={() => setTrackingMode("skeleton")}
              className={`px-3 py-1.5 rounded-md text-sm font-medium transition-all ${
                trackingMode === "skeleton"
                  ? "bg-purple-600 text-white"
                  : "text-gray-300 hover:bg-gray-600"
              }`}
            >
              🦴 Squelette
            </button>
            <button
              onClick={() => setTrackingMode("torso")}
              className={`px-3 py-1.5 rounded-md text-sm font-medium transition-all ${
                trackingMode === "torso"
                  ? "bg-green-600 text-white"
                  : "text-gray-300 hover:bg-gray-600"
              }`}
            >
              🫀 Tronc
            </button>
          </div>

          {/* Indicateur de connexion API */}
          <div className="flex items-center gap-2">
            <div className={`w-3 h-3 rounded-full ${apiConnected ? 'bg-green-500' : 'bg-yellow-500'} animate-pulse`}></div>
            <span className="text-sm text-gray-400">
              {apiConnected ? 'Connecté à la BDD' : 'Mode local'}
            </span>
          </div>

          <button
            onClick={handleReset}
            disabled={isSyncing}
            className={`px-4 py-2 rounded-lg font-semibold transition-colors duration-200 flex items-center gap-2 ${
              isSyncing 
                ? 'bg-gray-600 cursor-not-allowed' 
                : 'bg-red-600 hover:bg-red-700'
            }`}
          >
            {isSyncing ? (
              <>
                <div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent"></div>
                Réinitialisation...
              </>
            ) : (
              <>🔄 Réinitialiser</>
            )}
          </button>
        </div>
      </header>

      <main className="flex-1 p-2 overflow-hidden">
        {/* Zone vidéo avec compteurs en overlay */}
        <div className="relative rounded-xl overflow-hidden shadow-2xl bg-gray-800 h-full">
          {isLoading && (
            <div className="absolute inset-0 flex items-center justify-center bg-gray-800 z-10">
              <div className="text-center">
                <div className="animate-spin rounded-full h-16 w-16 border-4 border-blue-500 border-t-transparent mx-auto mb-4"></div>
                <p className="text-lg">Chargement du modèle MediaPipe...</p>
              </div>
            </div>
          )}

          {error && (
            <div className="absolute inset-0 flex items-center justify-center bg-gray-800 z-10">
              <div className="text-center text-red-400 p-8">
                <div className="text-6xl mb-4">⚠️</div>
                <p className="text-lg">{error}</p>
              </div>
            </div>
          )}

          <video ref={videoRef} autoPlay playsInline muted className="hidden" />

          <canvas
            ref={canvasRef}
            className="w-full h-full object-contain bg-gray-900"
          />

          {/* Compteurs en overlay sur la vidéo */}
          {!isLoading && !error && (
            <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 via-black/50 to-transparent p-4 pt-8">
              <div className="grid grid-cols-4 gap-3">
                <div className="bg-purple-600/70 backdrop-blur-sm rounded-xl p-3 text-center border border-purple-400/30">
                  <div className="text-sm font-medium text-purple-200">Détectées</div>
                  <div className="text-3xl font-bold">{detectedPeople}</div>
                  <div className="text-purple-300 text-xs">En ce moment</div>
                </div>

                <div className="bg-green-600/70 backdrop-blur-sm rounded-xl p-3 text-center border border-green-400/30">
                  <div className="text-sm font-medium text-green-200">Entrées</div>
                  <div className="text-3xl font-bold">{entrances}</div>
                  <div className="text-green-300 text-xs">→ Vers la droite</div>
                </div>

                <div className="bg-blue-600/70 backdrop-blur-sm rounded-xl p-3 text-center border border-blue-400/30">
                  <div className="text-sm font-medium text-blue-200">À l'intérieur</div>
                  <div className="text-3xl font-bold">{totalInside}</div>
                  <div className="text-blue-300 text-xs">
                    {totalInside < 0 ? "Déjà présentes" : "Actuellement"}
                  </div>
                </div>

                <div className="bg-red-600/70 backdrop-blur-sm rounded-xl p-3 text-center border border-red-400/30">
                  <div className="text-sm font-medium text-red-200">Sorties</div>
                  <div className="text-3xl font-bold">{exits}</div>
                  <div className="text-red-300 text-xs">← Vers la gauche</div>
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
