const request = require('request-promise-native');
const querystring = require('querystring');
const moment = require('moment');
const crypto = require('crypto');
// const _ = require('lodash');

const User = require('./user.model');

const SLACK = {
  token: process.env.SLACK_TOKEN,
  team_id: process.env.SLACK_TEAM_ID,
}

const SPOTIFY = {
  scope: 'user-read-currently-playing',
  client_id: process.env.SPOTIFY_CLIENT_ID,
  client_secret: process.env.SPOTIFY_CLIENT_SECRET,
  redirect_uri: `${process.env.APP_LOCATION}/user/link/spotify`,
};

SPOTIFY.headers = {
  Authorization: 'Basic ' + Buffer.from(`${ SPOTIFY.client_id }:${ SPOTIFY.client_secret }`).toString('base64')
};

async function nowPlaying(req, res) {
  try {
    if (req.body.token !== SLACK.token) throw Error('Slack app token mismatch.'); //check slack verification token
    if (req.body.team_id !== SLACK.team_id) throw Error('Team id mismatch.'); // check team id as well

    res.json({
      response_type: 'ephemeral',
      text: `${req.body.command} ${req.body.text}`,
    });

    const slack_response_url = req.body.response_url;
    const id = req.body.user_id;
    const user = await User.findOne({ id }).exec();

    if (user && user.spotify && user.spotify.refresh_token) {
      await refreshAccessToken(user);

      // use the access token to access the Spotify Web API
      const nowPlaying = await request.get('https://api.spotify.com/v1/me/player/currently-playing', {
        headers: { 'Authorization': 'Bearer ' + user.spotify.access_token },
        json: true
      });

      if (nowPlaying) {
        /*
        const trackInfo = {
          name: nowPlaying.item.name,
          artists: _.map(nowPlaying.item.artists, artist => artist.name).join(', '),
          url: nowPlaying.item.external_urls.spotify,
        };
        */
        let text = `<@${id}>: `;
        if (req.body.text) {
          text += req.body.text+'\n';
        }
        text += nowPlaying.item.external_urls.spotify;

        request.post(slack_response_url, {
          body: {
            response_type: 'in_channel',
            unfurl_media: true,
            text,
          },
          json: true,
        });
      }
      //nothing is playing right now
      else {
        request.post(slack_response_url, {
          body: {
            response_type: 'ephemeral', // only show this to the user who called it
            text: `Ain't nothing playing ya mad lad.`,
          },
          json: true,
        });
      }
    }

    else {
      console.log(`User with id ${id} hasn't linked Spotify, creating linking url.`);

      const url = await newUserUrl(id);
      request.post(slack_response_url, {
        body: {
          response_type: 'ephemeral', // only show this to the user who called it
          text: 'Press the button to link your Spotify account 👀',
          attachments: [{
            fallback: url,
            image_url: 'https://thumbs.gfycat.com/LawfulLikelyAmericanbadger-max-1mb.gif',
            actions: [{
              url,
              type: 'button',
              text: '👌 Link Spotify 👌',
              style: 'primary',
            }],
          }]
        },
        json: true,
      });
    }
  } catch (e) { handleError(e, res); }
}


async function newUserUrl(id) {
  const encryptedId = await encrypt(id);

  await User.findOneAndUpdate(  //very verbose upsert
    { id },
    { id },
    { upsert: true }
  ).exec();

  const query = querystring.stringify({
    response_type: 'code',
    client_id: SPOTIFY.client_id,
    scope: SPOTIFY.scope,
    redirect_uri: SPOTIFY.redirect_uri,
    state: encryptedId,
  });

  return `https://accounts.spotify.com/authorize?${query}`;
}



async function linkSpotifyCallback(req, res) {
  // handle cancels
  if (req.query.error) {
    return res.redirect('https://www.youtube.com/watch?v=dQw4w9WgXcQ') //TODO lul
  }
  try {
    const code = req.query.code || null;
    const state = req.query.state || null;
    const id = decrypt(state);
    const user = await User.findOne({ id }).exec();

    if (!user) throw Error('User not found.');

    const auth = await request.post('https://accounts.spotify.com/api/token', {
      form: {
        code: code,
        redirect_uri: SPOTIFY.redirect_uri,
        grant_type: 'authorization_code'
      },
      headers: SPOTIFY.headers,
      json: true
    });

    user.spotify = {
      scope: auth.scope.split(' '),
      refresh_token: auth.refresh_token,
      access_token: auth.access_token,
      valid_until: moment().add((auth.expires_in, 10), 's'),
    }
    await user.save();

    console.log(`Updated user ${id} with spotify tokens.`);

    res.redirect('https://www.youtube.com/watch?v=i1IqqlW1U4k'); //TODO lul

  } catch (e) { handleError(e, res); }
}

async function refreshAccessToken(user) {
  // no need to refresh if the access token is still valid
  if (moment().isBefore(moment(user.spotify.valid_until))) return user;

  const fresh = await request.post('https://accounts.spotify.com/api/token', {
    headers: SPOTIFY.headers,
    form: {
      grant_type: 'refresh_token',
      refresh_token: user.spotify.refresh_token
    },
    json: true
  });

  user.spotify.access_token = fresh.access_token;
  user.spotify.valid_until = moment().add(fresh.expires_in, 's');
  await user.save();
  return user;
}


const algorithm = 'aes256';
const password = process.env.APP_SECRET;

async function encrypt(text){
  const iv = await crypto.randomBytes(16);

  const cipher = crypto.createCipheriv(algorithm, password, iv);
  let crypted = cipher.update(text,'utf8','hex');
  crypted += cipher.final('hex');

  return `${crypted}&${iv.toString('hex')}`;
}

function decrypt(text){
  const encryptedId = text.split('&')[0];
  const iv = Buffer.from(text.split('&')[1], 'hex');

  const decipher = crypto.createDecipheriv(algorithm, password, iv);
  let dec = decipher.update(encryptedId,'hex','utf8');
  dec += decipher.final('utf8');
  return dec;
}

function handleError(error, res) {
  console.error(error.message);
  res.sendStatus(400);
}

module.exports = {
  nowPlaying,
  linkSpotifyCallback,
}
