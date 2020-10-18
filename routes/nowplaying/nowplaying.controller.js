const querystring = require("querystring");
const crypto = require("crypto");
const AWS = require("aws-sdk");
const axios = require("axios").default;

const USERS_TABLE = process.env.USERS_TABLE;
const dynamoDb = new AWS.DynamoDB.DocumentClient();

const SLACK = {
  token: process.env.SLACK_TOKEN,
  team_id: process.env.SLACK_TEAM_ID,
};

const SPOTIFY = {
  scope: "user-read-currently-playing",
  client_id: process.env.SPOTIFY_CLIENT_ID,
  client_secret: process.env.SPOTIFY_CLIENT_SECRET,
  redirect_uri: `${process.env.APP_LOCATION}/user/link/spotify`,
};

SPOTIFY.headers = {
  Authorization:
    "Basic " +
    Buffer.from(`${SPOTIFY.client_id}:${SPOTIFY.client_secret}`).toString(
      "base64"
    ),
  "Content-Type": "application/x-www-form-urlencoded",
};

async function nowPlaying(req, res) {
  try {
    if (req.body.token !== SLACK.token)
      throw Error("Slack app token mismatch."); //check slack verification token
    if (req.body.team_id !== SLACK.team_id) throw Error("Team id mismatch."); // check team id as well

    const id = req.body.user_id;
    const query = await getUser(id);
    const user = query.Item;
    if (user && user.spotify && user.spotify.refresh_token) {
      const access_token = await getAccessToken(user.spotify.refresh_token);
      // use the access token to access the Spotify Web API
      const response = await axios.get(
        "https://api.spotify.com/v1/me/player/currently-playing",
        {
          headers: { Authorization: "Bearer " + access_token },
        }
      );

      const nowPlaying = response.data;

      if (nowPlaying && nowPlaying.is_playing) {
        let text = `<@${id}>: `;
        if (req.body.text) text += req.body.text + "\n";
        text += nowPlaying.item.external_urls.spotify;

        res.json({
          response_type: "in_channel",
          unfurl_media: true,
          text,
        });
      }
      //nothing is playing right now
      else {
        res.json({
          response_type: "ephemeral", // only show this to the user who called it
          text: `Ain't nothing playing ya mad lad :madcunt:`,
        });
      }
    } else {
      console.log(
        `User with id ${id} hasn"t linked Spotify, creating linking url.`
      );

      const url = await newUserUrl(id);
      res.json({
        response_type: "ephemeral", // only show this to the user who called it
        text: "Press the button to link your Spotify account 👀",
        attachments: [
          {
            fallback: url,
            image_url:
              "https://thumbs.gfycat.com/LawfulLikelyAmericanbadger-max-1mb.gif",
            actions: [
              {
                url,
                type: "button",
                text: "👌 Link Spotify 👌",
                style: "primary",
              },
            ],
          },
        ],
      });
    }
  } catch (e) {
    console.error(e.message);
  }
}

async function newUserUrl(id) {
  await createUser(id);

  const query = querystring.stringify({
    response_type: "code",
    client_id: SPOTIFY.client_id,
    scope: SPOTIFY.scope,
    redirect_uri: SPOTIFY.redirect_uri,
    state: encrypt(id),
  });

  return `https://accounts.spotify.com/authorize?${query}`;
}

async function linkSpotifyCallback(event) {
  // handle cancels
  if (event.queryStringParameters.error) {
    throw new Error("fail");
  }

  const code = event.queryStringParameters.code || null;
  const state = event.queryStringParameters.state || null;
  const id = decrypt(state);
  const query = await getUser(id);
  const user = query.Item;

  if (!user) throw Error("User not found.");

  const form = {
    code,
    redirect_uri: SPOTIFY.redirect_uri,
    grant_type: "authorization_code",
  };

  const response = await axios.post(
    "https://accounts.spotify.com/api/token",
    querystring.stringify(form),
    {
      headers: SPOTIFY.headers,
    }
  );
  const auth = response.data;

  const scope = auth.scope.split(" ");
  const refresh_token = auth.refresh_token;

  await updateUser(id, scope, refresh_token);

  console.log(`Updated user ${id} with spotify tokens.`);

  return {
    statusCode: 301,
    headers: {
      Location: "https://www.youtube.com/watch?v=i1IqqlW1U4k",
    },
  };
}

async function getAccessToken(refresh_token) {
  const form = {
    grant_type: "refresh_token",
    refresh_token,
  };

  const fresh = await axios.post(
    "https://accounts.spotify.com/api/token",
    querystring.stringify(form),
    {
      headers: { Authorization: SPOTIFY.headers.Authorization },
    }
  );

  return fresh.data.access_token;
}

async function getUser(id) {
  const params = {
    TableName: USERS_TABLE,
    Key: {
      id,
    },
  };
  return dynamoDb.get(params).promise();
}

async function createUser(id) {
  const params = {
    TableName: USERS_TABLE,
    Key: {
      id: id,
    },
    UpdateExpression: "set spotify = :empty",
    ExpressionAttributeValues: {
      ":empty": {
        scope: "",
        refresh_token: "",
      },
    },
    ReturnValues: "UPDATED_NEW",
  };

  return dynamoDb.update(params).promise();
}

async function updateUser(id, scope, refresh_token) {
  const params = {
    TableName: USERS_TABLE,
    Key: {
      id,
    },
    UpdateExpression: "set spotify.#s = :s, spotify.refresh_token=:r",
    ExpressionAttributeNames: {
      "#s": "scope",
    },
    ExpressionAttributeValues: {
      ":s": scope,
      ":r": refresh_token,
    },
    ReturnValues: "UPDATED_NEW",
  };

  return dynamoDb.update(params).promise();
}

const algorithm = "aes256";
const password = process.env.APP_SECRET;

function encrypt(text) {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(algorithm, password, iv);

  const crypted = Buffer.concat([cipher.update(text), cipher.final()]);

  return `${crypted.toString("hex")}&${iv.toString("hex")}`;
}

function decrypt(text) {
  const encryptedId = Buffer.from(text.split("&")[0], "hex");
  const iv = Buffer.from(text.split("&")[1], "hex");

  const decipher = crypto.createDecipheriv(algorithm, password, iv);

  const decrpyted = Buffer.concat([
    decipher.update(encryptedId),
    decipher.final(),
  ]);

  return decrpyted.toString();
}

module.exports = {
  nowPlaying,
  linkSpotifyCallback,
};
