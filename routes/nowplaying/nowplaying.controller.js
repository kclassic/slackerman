const crypto = require("node:crypto");
const axios = require("axios").create({
  timeout: 2000,
  maxRedirects: 0,
});

const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const {
  DynamoDBDocumentClient,
  GetCommand,
  UpdateCommand,
} = require("@aws-sdk/lib-dynamodb");

const USERS_TABLE = process.env.USERS_TABLE;

const dynamoDb = DynamoDBDocumentClient.from(
  new DynamoDBClient({ maxAttempts: 2 }),
  {
    marshallOptions: {
      removeUndefinedValues: true,
    },
  }
);

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
    if (
      !SLACK.token ||
      !SLACK.team_id ||
      !req.body ||
      req.body.token !== SLACK.token ||
      req.body.team_id !== SLACK.team_id
    ) {
      return res.status(403).json({ error: "Invalid Slack request." });
    }

    if (typeof req.body.user_id !== "string" || !req.body.user_id) {
      return res.status(400).json({ error: "Missing Slack user ID." });
    }

    const id = req.body.user_id;
    const query = await getUser(id);
    const user = query.Item;
    if (user && user.spotify && user.spotify.refresh_token) {
      let access_token;

      try {
        access_token = await getAccessToken(user.spotify.refresh_token);
      } catch (e) {
        if (
          e.response?.status !== 400 ||
          e.response?.data?.error !== "invalid_grant"
        ) {
          throw e; // Other errors go to the existing outer catch.
        }

        // Remove the invalid token, keeping the user record.
        await dynamoDb.send(
          new UpdateCommand({
            TableName: USERS_TABLE,
            Key: { id },
            UpdateExpression: "REMOVE spotify.refresh_token",
          })
        );

        const url = await newUserUrl(id);

        return res.json({
          response_type: "ephemeral",
          text: `Your Spotify connection expired or was revoked. <${url}|Reconnect Spotify>`,
        });
      }
      // use the access token to access the Spotify Web API
      const response = await axios.get(
        "https://api.spotify.com/v1/me/player/currently-playing",
        {
          headers: { Authorization: "Bearer " + access_token },
        }
      );

      const nowPlaying = response.data;

      if (
        nowPlaying?.is_playing &&
        nowPlaying.item?.external_urls?.spotify
      ) {
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
    console.error("nowPlaying failed:", e.message);

    return res.status(200).json({
      response_type: "ephemeral",
      text: "Couldn't get your Spotify playback. Please try again shortly.",
    });
  }
}

async function newUserUrl(id) {
  await createUser(id);

  const query = new URLSearchParams({
    response_type: "code",
    client_id: SPOTIFY.client_id,
    scope: SPOTIFY.scope,
    redirect_uri: SPOTIFY.redirect_uri,
    state: encrypt(id),
  }).toString();

  return `https://accounts.spotify.com/authorize?${query}`;
}

async function linkSpotifyCallback(event) {
  // handle cancels
  const parameters = event.queryStringParameters ?? {};

  if (parameters.error) {
    return {
      statusCode: 400,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
      body: "Spotify authorization was cancelled or denied.",
    };
  }

  const { code, state } = parameters;

  if (typeof code !== "string" || typeof state !== "string") {
    return {
      statusCode: 400,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
      body: "Missing Spotify authorization code or state.",
    };
  }
  let id;

  try {
    id = decrypt(state);
  } catch {
    return {
      statusCode: 400,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
      body: "Invalid authorization state. Request a new link in Slack.",
    };
  }
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
    new URLSearchParams(form).toString(),
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
    statusCode: 302,
    headers: {
      Location: "https://www.youtube.com/watch?v=i1IqqlW1U4k",
      "Cache-Control": "no-store",
    },
    body: "",
  };
}

async function getAccessToken(refresh_token) {
  const form = {
    grant_type: "refresh_token",
    refresh_token,
  };

  const fresh = await axios.post(
    "https://accounts.spotify.com/api/token",
    new URLSearchParams(form).toString(),
    {
      headers: SPOTIFY.headers,
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
  return dynamoDb.send(new GetCommand(params));
}

async function createUser(id) {
  const params = {
    TableName: USERS_TABLE,
    Key: {
      id: id,
    },
    UpdateExpression: "SET spotify = if_not_exists(spotify, :empty)",
    ExpressionAttributeValues: {
      ":empty": {
        scope: "",
        refresh_token: "",
      },
    },
    ReturnValues: "UPDATED_NEW",
  };

  return dynamoDb.send(new UpdateCommand(params));
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

  return dynamoDb.send(new UpdateCommand(params));
}

const algorithm = "aes-256-cbc";
const password = Buffer.from(process.env.APP_SECRET ?? "", "utf8");

if (password.length !== 32) {
  throw new Error("APP_SECRET must contain exactly 32 UTF-8 bytes.");
}

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
