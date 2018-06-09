const router = require('express').Router();
const bodyParser = require('body-parser');
const controller = require('./nowplaying.controller');

const urlencodedParser = bodyParser.urlencoded({ extended: true });

router.post('/nowplaying', urlencodedParser, controller.nowPlaying)
router.get('/user/link/spotify', controller.linkSpotifyCallback);

module.exports = router;
