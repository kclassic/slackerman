module.exports = (app) => {
  app.use('/', require('./nowplaying'));
  app.use('/wordcloud', require('./wordcloud'));
}
