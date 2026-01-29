const express = require("express");
const path = require("path");
const fs = require("fs");

/**
 * Configure les routes web statiques pour l'application
 * @param {express.Application} app - Instance Express
 */
function setupWebRoutes(app) {
  // Middleware pour servir les fichiers statiques récursivement
  function serveStaticRecursive(rootDir) {
    return function (req, res, next) {
      const filePath = path.join(rootDir, req.path);
      if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
        res.sendFile(filePath);
      } else {
        next();
      }
    };
  }

  // Servir les fichiers statiques depuis le dossier 'assets'
  app.use(serveStaticRecursive(path.join(__dirname, "assets")));

  // Route principale
  app.get("/", (req, res) => {
    res.header("Content-type", "text/html");
    res.sendFile(path.join(__dirname, "/assets/index.html"));
  });

  // Routes pour les pages SPA
  const spaRoutes = [
    "/about",
    "/fleet",
    "/courses",
    "/contact",
    "/job",
    "/legal",
    "/privacy",
    "/certif"
  ];

  spaRoutes.forEach((route) => {
    app.get(route, (req, res) => {
      res.header("Content-type", "text/html");
      res.sendFile(path.join(__dirname, "/assets/index.html"));
    });
  });

  // Favicon
  app.get("/favicon.ico", (req, res) => {
    res.header("Content-type", "image/x-icon");
    res.sendFile(path.join(__dirname, "/assets/favicon.ico"));
  });
}

/**
 * Middleware 404 - à appeler après toutes les autres routes
 * @param {express.Application} app - Instance Express
 */
function setup404Handler(app) {
  app.use((req, res) => {
    res.status(404).sendFile(path.join(__dirname, "/assets/index.html"));
  });
}

module.exports = {
  setupWebRoutes,
  setup404Handler
};
