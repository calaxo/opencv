import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  Title,
  Tooltip,
  Legend,
  Filler,
} from "chart.js";
import { Line, Bar } from "react-chartjs-2";

// Enregistrer les composants Chart.js
ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  Title,
  Tooltip,
  Legend,
  Filler,
);

const API_BASE_URL =
  import.meta.env.VITE_API_URL || "http://localhost:5500/api";

function Stats() {
  const [statsData, setStatsData] = useState([]);
  const [currentCounter, setCurrentCounter] = useState({
    entrances: 0,
    exits: 0,
    currentInside: 0,
  });
  const [period, setPeriod] = useState("hour");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

  // Charger les données
  useEffect(() => {
    const fetchData = async () => {
      setIsLoading(true);
      try {
        // Récupérer les stats agrégées
        const statsRes = await fetch(
          `${API_BASE_URL}/counter/stats?period=${period}`,
        );
        if (statsRes.ok) {
          const statsJson = await statsRes.json();
          setStatsData(statsJson.data || []);
        }

        // Récupérer le compteur actuel
        const counterRes = await fetch(`${API_BASE_URL}/counter`);
        if (counterRes.ok) {
          const counterJson = await counterRes.json();
          setCurrentCounter(
            counterJson.data || { entrances: 0, exits: 0, currentInside: 0 },
          );
        }

        setError(null);
      } catch (err) {
        console.error("Erreur chargement données:", err);
        setError("Impossible de charger les données");
      }
      setIsLoading(false);
    };

    fetchData();

    // Rafraîchir toutes les 10 secondes
    const interval = setInterval(fetchData, 10000);
    return () => clearInterval(interval);
  }, [period]);

  // Préparer les données pour le graphique en ligne
  const lineChartData = {
    labels: statsData.map((d) => {
      // Formater les labels selon la période
      if (period === "hour" || period === "minute") {
        return d.period.split(" ")[1] || d.period;
      }
      return d.period;
    }),
    datasets: [
      {
        label: "Entrées",
        data: statsData.map((d) => d.entrances),
        borderColor: "#00ff88",
        backgroundColor: "rgba(0, 255, 136, 0.1)",
        fill: false,
        tension: 0.3,
        pointRadius: 4,
        pointBackgroundColor: "#00ff88",
      },
      {
        label: "Sorties",
        data: statsData.map((d) => d.exits),
        borderColor: "#ff3366",
        backgroundColor: "rgba(255, 51, 102, 0.1)",
        fill: false,
        tension: 0.3,
        pointRadius: 4,
        pointBackgroundColor: "#ff3366",
      },
      {
        label: "Présents",
        data: statsData.map((d) => d.currentInside),
        borderColor: "#00aaff",
        backgroundColor: "rgba(0, 170, 255, 0.15)",
        fill: true,
        tension: 0.3,
        pointRadius: 4,
        pointBackgroundColor: "#00aaff",
      },
    ],
  };

  const lineChartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        position: "top",
        labels: {
          color: "#e0e0e0",
          font: { family: "monospace" },
        },
      },
      title: {
        display: true,
        text: `Entrées et Sorties par ${period === "hour" ? "heure" : period === "day" ? "jour" : period === "minute" ? "minute" : period}`,
        color: "#ff6b35",
        font: { size: 16, family: "monospace", weight: "bold" },
      },
    },
    scales: {
      x: {
        ticks: { color: "#888" },
        grid: { color: "rgba(255,255,255,0.1)" },
      },
      y: {
        ticks: { color: "#888" },
        grid: { color: "rgba(255,255,255,0.1)" },
        beginAtZero: true,
      },
    },
  };

  // Données pour le graphique à barres (total)
  const barChartData = {
    labels: ["Entrées", "Sorties", "À l'intérieur"],
    datasets: [
      {
        label: "Total",
        data: [
          currentCounter.entrances,
          currentCounter.exits,
          currentCounter.currentInside,
        ],
        backgroundColor: ["#00ff88", "#ff3366", "#00aaff"],
        borderColor: ["#00ff88", "#ff3366", "#00aaff"],
        borderWidth: 2,
      },
    ],
  };

  const barChartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      title: {
        display: true,
        text: "Totaux actuels",
        color: "#ff6b35",
        font: { size: 16, family: "monospace", weight: "bold" },
      },
    },
    scales: {
      x: {
        ticks: { color: "#e0e0e0", font: { family: "monospace" } },
        grid: { display: false },
      },
      y: {
        ticks: { color: "#888" },
        grid: { color: "rgba(255,255,255,0.1)" },
        beginAtZero: true,
      },
    },
  };

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-[#e0e0e0] font-mono">
      {/* Header */}
      <header className="bg-[#111] border-b-2 border-[#ff6b35] px-4 py-3">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <div className="w-2 h-8 bg-[#ff6b35]"></div>
            <h1 className="text-lg font-bold tracking-wider uppercase text-white">
              Statistiques
            </h1>
          </div>

          {/* Sélecteur de période */}
          <div className="flex items-center gap-1 bg-[#1a1a1a] p-1">
            {["minute", "hour", "day"].map((p) => (
              <button
                key={p}
                onClick={() => setPeriod(p)}
                className={`px-3 py-1 text-xs uppercase tracking-wide transition-all ${
                  period === p
                    ? "bg-[#ff6b35] text-black font-bold"
                    : "text-[#888] hover:text-white hover:bg-[#222]"
                }`}
              >
                {p === "minute" ? "Min" : p === "hour" ? "Heure" : "Jour"}
              </button>
            ))}
          </div>

          <Link
            to="/"
            className="px-4 py-1.5 text-xs uppercase tracking-wide border-2 border-[#ff6b35] text-[#ff6b35] hover:bg-[#ff6b35] hover:text-black transition-all"
          >
            ← Retour
          </Link>
        </div>
      </header>

      <main className="p-4">
        {isLoading && !statsData.length ? (
          <div className="flex items-center justify-center h-64">
            <div className="w-12 h-12 border-2 border-[#ff6b35] border-t-transparent animate-spin"></div>
          </div>
        ) : error ? (
          <div className="text-center p-8 border border-[#ff3333] bg-[#111]">
            <p className="text-[#ff3333] text-sm uppercase tracking-wide">
              {error}
            </p>
          </div>
        ) : (
          <>
            {/* Compteurs actuels */}
            <div className="grid grid-cols-3 gap-3 mb-6">
              <div className="bg-[#111] border-l-4 border-[#00ff88] p-4">
                <div className="text-[10px] uppercase tracking-widest text-[#00ff88] mb-1">
                  Total Entrées
                </div>
                <div className="text-3xl font-bold text-white">
                  {currentCounter.entrances}
                </div>
              </div>
              <div className="bg-[#111] border-l-4 border-[#00aaff] p-4">
                <div className="text-[10px] uppercase tracking-widest text-[#00aaff] mb-1">
                  À l'intérieur
                </div>
                <div className="text-3xl font-bold text-white">
                  {currentCounter.currentInside}
                </div>
              </div>
              <div className="bg-[#111] border-l-4 border-[#ff3366] p-4">
                <div className="text-[10px] uppercase tracking-widest text-[#ff3366] mb-1">
                  Total Sorties
                </div>
                <div className="text-3xl font-bold text-white">
                  {currentCounter.exits}
                </div>
              </div>
            </div>

            {/* Graphiques */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              {/* Graphique principal (2/3) */}
              <div className="lg:col-span-2 bg-[#111] border border-[#222] p-4">
                <div className="h-80">
                  {statsData.length > 0 ? (
                    <Line data={lineChartData} options={lineChartOptions} />
                  ) : (
                    <div className="flex items-center justify-center h-full text-[#666]">
                      Aucune donnée disponible
                    </div>
                  )}
                </div>
              </div>

              {/* Graphique à barres (1/3) */}
              <div className="bg-[#111] border border-[#222] p-4">
                <div className="h-80">
                  <Bar data={barChartData} options={barChartOptions} />
                </div>
              </div>
            </div>
          </>
        )}
      </main>
    </div>
  );
}

export default Stats;
