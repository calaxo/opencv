const mqtt = require("mqtt");
const { insertSensorData } = require("./db");

let client = null;

/**
 * Initialise la connexion MQTT et s'abonne aux topics
 * @returns {Promise<mqtt.MqttClient>}
 */
async function initMQTT() {
  return new Promise((resolve, reject) => {
    const brokerUrl = process.env.MQTT_BROKER_URL || "mqtt://localhost:1883";
    const topics = (process.env.MQTT_TOPICS || "sensors/#").split(",");

    const options = {
      clientId: process.env.MQTT_CLIENT_ID || `monitoring_server_${Date.now()}`,
      clean: true,
      connectTimeout: 10000,
      reconnectPeriod: 5000,
    };

    // Authentification si configurée
    if (process.env.MQTT_USERNAME) {
      options.username = process.env.MQTT_USERNAME;
    }
    if (process.env.MQTT_PASSWORD) {
      options.password = process.env.MQTT_PASSWORD;
    }

    console.log(`🔌 Connexion MQTT à ${brokerUrl}...`);
    client = mqtt.connect(brokerUrl, options);

    client.on("connect", () => {
      console.log("✅ Connecté au broker MQTT");

      // S'abonner aux topics
      topics.forEach((topic) => {
        const trimmedTopic = topic.trim();
        client.subscribe(trimmedTopic, (err) => {
          if (err) {
            console.error(`❌ Erreur abonnement au topic ${trimmedTopic}:`, err.message);
          } else {
            console.log(`📡 Abonné au topic: ${trimmedTopic}`);
          }
        });
      });

      resolve(client);
    });

    client.on("message", async (topic, message) => {
      try {
        const messageStr = message.toString();
        console.log(`📨 Message reçu sur ${topic}: ${messageStr.substring(0, 100)}...`);

        // Parser le message JSON
        let payload;
        try {
          payload = JSON.parse(messageStr);
        } catch {
          console.warn("⚠️ Message non-JSON ignoré:", messageStr.substring(0, 50));
          return;
        }

        // Vérifier que le message contient un sensor_id
        if (!payload.sensor_id) {
          console.warn("⚠️ Message sans sensor_id ignoré");
          return;
        }

        // Insérer dans la base de données
        await insertSensorData(payload);
        console.log(`💾 Données sauvegardées pour capteur ${payload.sensor_id}`);

      } catch (err) {
        console.error("❌ Erreur traitement message MQTT:", err.message);
      }
    });

    client.on("error", (err) => {
      console.error("❌ Erreur MQTT:", err.message);
      if (!client.connected) {
        reject(err);
      }
    });

    client.on("reconnect", () => {
      console.log("🔄 Reconnexion MQTT...");
    });

    client.on("offline", () => {
      console.log("📴 MQTT hors ligne");
    });

    client.on("close", () => {
      console.log("🔌 Connexion MQTT fermée");
    });

    // Timeout de connexion
    setTimeout(() => {
      if (!client.connected) {
        reject(new Error("Timeout de connexion MQTT"));
      }
    }, 15000);
  });
}

/**
 * Récupère le client MQTT
 * @returns {mqtt.MqttClient}
 */
function getClient() {
  return client;
}

/**
 * Publie un message sur un topic
 * @param {string} topic - Topic MQTT
 * @param {object|string} message - Message à publier
 * @returns {Promise<void>}
 */
async function publish(topic, message) {
  return new Promise((resolve, reject) => {
    if (!client || !client.connected) {
      reject(new Error("Client MQTT non connecté"));
      return;
    }

    const payload = typeof message === "string" ? message : JSON.stringify(message);
    
    client.publish(topic, payload, (err) => {
      if (err) {
        reject(err);
      } else {
        resolve();
      }
    });
  });
}

/**
 * Ferme la connexion MQTT
 * @returns {Promise<void>}
 */
async function closeMQTT() {
  return new Promise((resolve) => {
    if (client) {
      client.end(true, () => {
        console.log("🔌 Connexion MQTT fermée proprement");
        client = null;
        resolve();
      });
    } else {
      resolve();
    }
  });
}

module.exports = {
  initMQTT,
  getClient,
  publish,
  closeMQTT
};
