const express = require("express");
const controller = require("./nowplaying.controller");

const router = express.Router();

router.post(
  "/nowplaying",
  express.urlencoded({
    extended: false,
    limit: "32kb",
    parameterLimit: 100,
  }),
  controller.nowPlaying
);

module.exports = router;