const router = require('express').Router();
const controller = require('./wordcloud.controller');

router.get('/', controller.getWordCloud);

module.exports = router;
