const express = require('express');
const mongoose = require('mongoose');
const helmet = require('helmet');
const mountRoutes = require('./routes');


const app = express();
if (app.get('env') === 'development') {
  // eslint-disable-next-line node/no-unpublished-require
  require('dotenv').config(); // read .env variables into process.env
}

const PORT = process.env.PORT || 9001


mongoose.connect(process.env.MONGODB_URI);
mongoose.connection.on('error', (err) => {
  console.error('MongoDB connection error: ' + err);
  process.exit(-1); //eslint-disable-line no-process-exit
});


app.use(helmet()); //security stuff
mountRoutes(app);

app.listen(PORT, () => console.log(`Listening on ${PORT}`));
