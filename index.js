const express = require("express");
const serverless = require("serverless-http");

const mountRoutes = require("./routes");

const app = express();

mountRoutes(app);

module.exports = {
    handler: serverless(app),
    spotify: require("./routes/nowplaying/nowplaying.controller").linkSpotifyCallback,
} 
