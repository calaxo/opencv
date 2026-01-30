const Database = require("better-sqlite3");
const path = require("path");
const fs = require("fs");

let db = null;

/**
 * Initialise la base de données SQLite
 * @returns {Database}
 */
function initDatabase() {
  if (db) {
    return db;
  }

  const dbPath = process.env.DB_PATH || path.join(__dirname, "data", "database.sqlite");
  
  // Créer le dossier data s'il n'existe pas
  const dataDir = path.dirname(dbPath);
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  
  console.log("✅ Connexion à SQLite établie:", dbPath);

  // Créer la table des capteurs
  db.exec(`
    CREATE TABLE IF NOT EXISTS sensors (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sensor_id TEXT UNIQUE NOT NULL,
      name TEXT,
      location TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  console.log("✅ Table sensors prête");

  // Créer la table des données de capteurs
  db.exec(`
    CREATE TABLE IF NOT EXISTS sensor_data (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sensor_fk INTEGER NOT NULL,
      temperature REAL,
      presence INTEGER,
      received_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (sensor_fk) REFERENCES sensors(id) ON DELETE CASCADE
    )
  `);
  db.exec("CREATE INDEX IF NOT EXISTS idx_sensor_data_fk ON sensor_data(sensor_fk)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_sensor_data_received ON sensor_data(received_at)");
  console.log("✅ Table sensor_data prête");

  // Créer la table du compteur de personnes (valeurs actuelles)
  db.exec(`
    CREATE TABLE IF NOT EXISTS people_counter (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      entrances INTEGER DEFAULT 0,
      exits INTEGER DEFAULT 0,
      current_inside INTEGER DEFAULT 0,
      last_updated DATETIME DEFAULT CURRENT_TIMESTAMP,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  console.log("✅ Table people_counter prête");

  // Créer la table d'historique des comptages (pour les graphiques)
  db.exec(`
    CREATE TABLE IF NOT EXISTS counter_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_type TEXT NOT NULL CHECK(event_type IN ('entrance', 'exit')),
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  db.exec("CREATE INDEX IF NOT EXISTS idx_counter_history_timestamp ON counter_history(timestamp)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_counter_history_type ON counter_history(event_type)");
  console.log("✅ Table counter_history prête");

  // Insérer une ligne par défaut si la table est vide
  const existingCounter = db.prepare("SELECT id FROM people_counter LIMIT 1").get();
  if (!existingCounter) {
    db.prepare("INSERT INTO people_counter (entrances, exits, current_inside) VALUES (0, 0, 0)").run();
    console.log("✅ Compteur initialisé");
  }

  return db;
}

/**
 * Récupère l'instance de la base de données
 * @returns {Database}
 */
function getDb() {
  if (!db) {
    throw new Error("Database not initialized. Call initDatabase() first.");
  }
  return db;
}

// Alias pour compatibilité
function getPool() {
  return getDb();
}

/**
 * Récupère ou crée un capteur par son ID unique
 * @param {string} sensorId - ID unique du capteur Arduino
 * @returns {number} - ID de la clé primaire du capteur
 */
function getOrCreateSensor(sensorId) {
  const existing = db.prepare("SELECT id FROM sensors WHERE sensor_id = ?").get(sensorId);
  
  if (existing) {
    return existing.id;
  }

  const result = db.prepare("INSERT INTO sensors (sensor_id) VALUES (?)").run(sensorId);
  return result.lastInsertRowid;
}

/**
 * Récupère tous les capteurs enregistrés
 * @returns {Array}
 */
function getAllSensors() {
  return db.prepare("SELECT * FROM sensors ORDER BY created_at DESC").all();
}

/**
 * Met à jour les informations d'un capteur
 * @param {string} sensorId - ID unique du capteur
 * @param {object} data - Données à mettre à jour (name, location)
 * @returns {object}
 */
function updateSensor(sensorId, data) {
  return db.prepare("UPDATE sensors SET name = ?, location = ? WHERE sensor_id = ?")
    .run(data.name || null, data.location || null, sensorId);
}

/**
 * Insère des données de capteur dans la base
 * @param {object} data - Données du message MQTT
 * @returns {object}
 */
function insertSensorData(data) {
  const sensorFk = getOrCreateSensor(data.sensor_id);
  
  return db.prepare(
    "INSERT INTO sensor_data (sensor_fk, temperature, presence) VALUES (?, ?, ?)"
  ).run(
    sensorFk,
    data.temperature !== undefined ? data.temperature : null,
    data.presence !== undefined ? (data.presence ? 1 : 0) : null
  );
}

/**
 * Récupère toutes les données de capteurs avec filtrage
 * @param {object} options - Options de filtrage
 * @returns {Array}
 */
function getAllSensorData(options = {}) {
  let query = `
    SELECT sd.*, s.sensor_id, s.name as sensor_name, s.location as sensor_location 
    FROM sensor_data sd
    JOIN sensors s ON sd.sensor_fk = s.id
    WHERE 1=1
  `;
  const params = [];

  if (options.sensorId) {
    query += " AND s.sensor_id = ?";
    params.push(options.sensorId);
  }
  if (options.dataType === "temperature") {
    query += " AND sd.temperature IS NOT NULL";
  }
  if (options.dataType === "presence") {
    query += " AND sd.presence IS NOT NULL";
  }
  if (options.from) {
    query += " AND sd.received_at >= ?";
    params.push(options.from);
  }
  if (options.to) {
    query += " AND sd.received_at <= ?";
    params.push(options.to);
  }

  query += " ORDER BY sd.received_at DESC LIMIT ? OFFSET ?";
  params.push(parseInt(options.limit) || 100);
  params.push(parseInt(options.offset) || 0);

  return db.prepare(query).all(...params);
}

/**
 * Récupère les dernières données pour chaque capteur
 * @returns {Array}
 */
function getLatestSensorData() {
  return db.prepare(`
    SELECT sd.*, s.sensor_id, s.name as sensor_name, s.location as sensor_location 
    FROM sensor_data sd
    JOIN sensors s ON sd.sensor_fk = s.id
    WHERE sd.id IN (
      SELECT MAX(id) FROM sensor_data GROUP BY sensor_fk
    )
  `).all();
}

/**
 * Récupère les dernières températures pour chaque capteur
 * @returns {Array}
 */
function getLatestTemperatureData() {
  return db.prepare(`
    SELECT sd.*, s.sensor_id, s.name as sensor_name, s.location as sensor_location 
    FROM sensor_data sd
    JOIN sensors s ON sd.sensor_fk = s.id
    WHERE sd.temperature IS NOT NULL
    AND sd.id IN (
      SELECT MAX(id) FROM sensor_data WHERE temperature IS NOT NULL GROUP BY sensor_fk
    )
  `).all();
}

/**
 * Récupère les dernières données de présence pour chaque capteur
 * @returns {Array}
 */
function getLatestPresenceData() {
  return db.prepare(`
    SELECT sd.*, s.sensor_id, s.name as sensor_name, s.location as sensor_location 
    FROM sensor_data sd
    JOIN sensors s ON sd.sensor_fk = s.id
    WHERE sd.presence IS NOT NULL
    AND sd.id IN (
      SELECT MAX(id) FROM sensor_data WHERE presence IS NOT NULL GROUP BY sensor_fk
    )
  `).all();
}

/**
 * Récupère les statistiques des capteurs
 * @returns {object}
 */
function getSensorStats() {
  const totalMessages = db.prepare("SELECT COUNT(*) as count FROM sensor_data").get();
  const uniqueSensors = db.prepare("SELECT COUNT(*) as count FROM sensors").get();
  const temperatureReadings = db.prepare("SELECT COUNT(*) as count FROM sensor_data WHERE temperature IS NOT NULL").get();
  const presenceReadings = db.prepare("SELECT COUNT(*) as count FROM sensor_data WHERE presence IS NOT NULL").get();
  const lastMessage = db.prepare("SELECT received_at FROM sensor_data ORDER BY received_at DESC LIMIT 1").get();
  const avgTemperature = db.prepare("SELECT AVG(temperature) as avg FROM sensor_data WHERE temperature IS NOT NULL").get();

  return {
    totalMessages: totalMessages.count,
    uniqueSensors: uniqueSensors.count,
    temperatureReadings: temperatureReadings.count,
    presenceReadings: presenceReadings.count,
    lastMessageAt: lastMessage?.received_at || null,
    avgTemperature: avgTemperature?.avg ? Number(avgTemperature.avg).toFixed(2) : null
  };
}

// ========== PEOPLE COUNTER ==========

/**
 * Récupère le compteur de personnes actuel
 * @returns {object}
 */
function getPeopleCounter() {
  const row = db.prepare("SELECT * FROM people_counter ORDER BY id DESC LIMIT 1").get();
  if (row) {
    return {
      entrances: row.entrances,
      exits: row.exits,
      currentInside: row.current_inside,
      lastUpdated: row.last_updated
    };
  }
  return { entrances: 0, exits: 0, currentInside: 0, lastUpdated: null };
}

/**
 * Met à jour les valeurs du compteur de personnes
 * @param {object} data - { entrances, exits }
 * @returns {object}
 */
function updatePeopleCounter(data) {
  const entrances = data.entrances !== undefined ? Number(data.entrances) : 0;
  const exits = data.exits !== undefined ? Number(data.exits) : 0;
  const currentInside = entrances - exits;

  db.prepare(
    "UPDATE people_counter SET entrances = ?, exits = ?, current_inside = ?, last_updated = CURRENT_TIMESTAMP WHERE id = (SELECT id FROM people_counter ORDER BY id DESC LIMIT 1)"
  ).run(entrances, exits, currentInside);

  return { entrances, exits, currentInside };
}

/**
 * Incrémente le compteur d'entrées ou de sorties et enregistre dans l'historique
 * @param {string} type - 'entrance' ou 'exit'
 * @returns {object}
 */
function incrementPeopleCounter(type) {
  if (type === 'entrance') {
    db.prepare(
      "UPDATE people_counter SET entrances = entrances + 1, current_inside = entrances + 1 - exits, last_updated = CURRENT_TIMESTAMP WHERE id = (SELECT id FROM people_counter ORDER BY id DESC LIMIT 1)"
    ).run();
  } else if (type === 'exit') {
    db.prepare(
      "UPDATE people_counter SET exits = exits + 1, current_inside = entrances - exits - 1, last_updated = CURRENT_TIMESTAMP WHERE id = (SELECT id FROM people_counter ORDER BY id DESC LIMIT 1)"
    ).run();
  }
  
  // Enregistrer dans l'historique
  db.prepare("INSERT INTO counter_history (event_type) VALUES (?)").run(type);
  
  return getPeopleCounter();
}

/**
 * Réinitialise le compteur de personnes
 * @returns {object}
 */
function resetPeopleCounter() {
  db.prepare(
    "UPDATE people_counter SET entrances = 0, exits = 0, current_inside = 0, last_updated = CURRENT_TIMESTAMP WHERE id = (SELECT id FROM people_counter ORDER BY id DESC LIMIT 1)"
  ).run();
  return { entrances: 0, exits: 0, currentInside: 0 };
}

// ========== HISTORIQUE DES COMPTAGES ==========

/**
 * Enregistre un événement d'entrée ou de sortie dans l'historique
 * @param {string} eventType - 'entrance' ou 'exit'
 * @returns {object}
 */
function logCounterEvent(eventType) {
  return db.prepare("INSERT INTO counter_history (event_type) VALUES (?)").run(eventType);
}

/**
 * Récupère l'historique des comptages
 * @param {object} options - { from, to, limit }
 * @returns {Array}
 */
function getCounterHistory(options = {}) {
  let query = "SELECT * FROM counter_history WHERE 1=1";
  const params = [];

  if (options.from) {
    query += " AND timestamp >= ?";
    params.push(options.from);
  }
  if (options.to) {
    query += " AND timestamp <= ?";
    params.push(options.to);
  }

  query += " ORDER BY timestamp DESC";

  if (options.limit) {
    query += " LIMIT ?";
    params.push(parseInt(options.limit));
  }

  return db.prepare(query).all(...params);
}

/**
 * Récupère les statistiques par période (heure, jour, etc.)
 * @param {string} period - 'minute', 'hour', 'day', 'week', 'month'
 * @param {string} from - Date de début
 * @param {string} to - Date de fin
 * @returns {Array}
 */
function getCounterStats(period = 'hour', from = null, to = null) {
  let groupFormat;
  switch (period) {
    case 'minute':
      groupFormat = "%Y-%m-%d %H:%M";
      break;
    case 'hour':
      groupFormat = "%Y-%m-%d %H:00";
      break;
    case 'day':
      groupFormat = "%Y-%m-%d";
      break;
    case 'week':
      groupFormat = "%Y-%W";
      break;
    case 'month':
      groupFormat = "%Y-%m";
      break;
    default:
      groupFormat = "%Y-%m-%d %H:00";
  }

  let query = `
    SELECT 
      strftime('${groupFormat}', timestamp) as period,
      SUM(CASE WHEN event_type = 'entrance' THEN 1 ELSE 0 END) as entrances,
      SUM(CASE WHEN event_type = 'exit' THEN 1 ELSE 0 END) as exits
    FROM counter_history
    WHERE 1=1
  `;
  const params = [];

  if (from) {
    query += " AND timestamp >= ?";
    params.push(from);
  }
  if (to) {
    query += " AND timestamp <= ?";
    params.push(to);
  }

  query += ` GROUP BY strftime('${groupFormat}', timestamp) ORDER BY period ASC`;

  return db.prepare(query).all(...params);
}

/**
 * Ferme la base de données
 */
function closeDatabase() {
  if (db) {
    db.close();
    db = null;
    console.log("🔌 Connexion SQLite fermée");
  }
}

module.exports = {
  initDatabase,
  getDb,
  getPool,
  getOrCreateSensor,
  getAllSensors,
  updateSensor,
  insertSensorData,
  getAllSensorData,
  getLatestSensorData,
  getLatestTemperatureData,
  getLatestPresenceData,
  getSensorStats,
  closeDatabase,
  // People Counter
  getPeopleCounter,
  updatePeopleCounter,
  incrementPeopleCounter,
  resetPeopleCounter,
  // Historique
  logCounterEvent,
  getCounterHistory,
  getCounterStats
};
