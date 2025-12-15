const express = require('express');
const path = require('path');
const http = require('http');
const { Server } = require('socket.io');
const { PubSub } = require('@google-cloud/pubsub');
const { BigQuery } = require('@google-cloud/bigquery');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Serve static files from the 'public' directory
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());


const port = process.env.PORT || 8080;
const projectId = process.env.PROJECT_ID; // Required env var
const topicId = process.env.TOPIC_ID;     // Required env var
//process.env.GOOGLE_CLOUD_USE_BROWSER_BUILD = "false";
const subscriptionName = 'pubsub-stream-sub'; // Fixed subscription name for simplicity
const datasetId = 'chat_history_dataset';
const tableId = 'messages';

async function startPubSub() {
  if (!projectId || !topicId) {
    console.error('ERROR: PROJECT_ID and TOPIC_ID environment variables are required.');
    return;
  }
  //process.env.GOOGLE_CLOUD_USE_BROWSER_BUILD = "false";
  const pubSubClient = new PubSub({ projectId });
  const bigquery = new BigQuery({ projectId });

  // Initialize BigQuery Dataset and Table
  async function initBigQuery() {
    try {
      const [dataset] = await bigquery.dataset(datasetId).get({ autoCreate: true });
      console.log(`Dataset ${dataset.id} created or already exists.`);

      const schema = [
        { name: 'conversationId', type: 'STRING' },
        { name: 'channel', type: 'STRING' },
        { name: 'translatedtext', type: 'STRING' },
        { name: 'publishTime', type: 'TIMESTAMP' },
      ];

      const [table] = await dataset.table(tableId).get({ schema, autoCreate: true });
      console.log(`Table ${table.id} created or already exists.`);
    } catch (err) {
      console.error('Error initializing BigQuery:', err);
    }
  }

  await initBigQuery();


  // Function to get or create subscription
  async function getSubscription() {
    const subscription = pubSubClient.subscription(subscriptionName);
    const [exists] = await subscription.exists();
    if (exists) {
      console.log(`Subscription ${subscriptionName} already exists.`);
      return subscription;
    } else {
      console.log(`Creating subscription ${subscriptionName} to topic ${topicId}...`);
      const [newSubscription] = await pubSubClient.createSubscription(topicId, subscriptionName);
      console.log(`Subscription ${subscriptionName} created.`);
      return newSubscription;
    }
  }

  try {
    const subscription = await getSubscription();

    subscription.on('message', async message => {
      const dataStr = message.data.toString();
      console.log('Received message:', dataStr);

      try {
        const content = JSON.parse(dataStr);
        const conversationId = content.conversationId;

        // Async write to BigQuery
        const row = {
          conversationId: conversationId,
          channel: content.channel,
          translatedtext: content.translatedtext || dataStr, // Fallback if structure differs
          publishTime: bigquery.datetime(message.publishTime.toISOString()),
        };

        // Don't await to avoid blocking UI stream
        bigquery
          .dataset(datasetId)
          .table(tableId)
          .insert([row])
          .then(() => console.log(`Inserted 1 row for conversation ${conversationId}`))
          .catch(err => {
            console.error('ERROR: Insight BigQuery insert failed:', err);
            if (err.name === 'PartialFailureError') {
               err.errors.forEach(error => console.error(error));
            }
          });


        if (conversationId) {
          console.log(`Broadcasting to room: conversation-${conversationId}`);
          io.to(`conversation-${conversationId}`).emit('pubsub-message', {
            data: dataStr,
            attributes: message.attributes,
            publishTime: message.publishTime,
            id: message.id
          });
        } else {
          console.warn('Message received without conversationId, ignoring.');
        }

      } catch (err) {
        console.error('Error parsing message data:', err);
      }

      message.ack();
    });

    subscription.on('error', error => {
      console.error('Received error:', error);
    });

    console.log(`Listening for messages on ${subscriptionName}...`);
  } catch (error) {
    console.error('Error setting up Pub/Sub:', error);
  }
}

startPubSub();

io.on('connection', (socket) => {
  console.log('a user connected');

  socket.on('join', (conversationId) => {
    if (conversationId) {
      const room = `conversation-${conversationId}`;
      socket.join(room);
      console.log(`Socket ${socket.id} joined ${room}`);
    }
  });

  socket.on('disconnect', () => {
    console.log('user disconnected');
  });
});

app.post('/simulate-message', (req, res) => {
  const { conversationId, message, sender } = req.body;

  if (!conversationId || !message) {
    return res.status(400).send('Missing conversationId or message');
  }

  const payload = JSON.stringify({
    conversationId,
    channel: sender === 'external' ? 'external' : 'internal',
    translatedtext: message
  });

  io.to(`conversation-${conversationId}`).emit('pubsub-message', {
    data: payload,
    attributes: {},
    publishTime: new Date().toISOString(),
    id: 'sim-' + Date.now()
  });

  res.send({ status: 'Message emitted to ' + conversationId });
});

// API to fetch conversation history
app.get('/api/history/:conversationId', async (req, res) => {
  const conversationId = req.params.conversationId;
  const projectId = process.env.PROJECT_ID;

  if (!projectId) {
     return res.status(500).send('Server misconfigured: PROJECT_ID missing');
  }
  
  const bigquery = new BigQuery({ projectId });

  const query = `
    SELECT *
    FROM \`${projectId}.${datasetId}.${tableId}\`
    WHERE conversationId = @conversationId
    ORDER BY publishTime ASC
  `;

  const options = {
    query: query,
    params: { conversationId: conversationId },
  };

  try {
    const [rows] = await bigquery.query(options);
    console.log(`Retrieved ${rows.length} rows for history`);
    res.json(rows);
  } catch (err) {
    console.error('BigQuery Query Error:', err);
    res.status(500).json({ error: 'Failed to fetch history' });
  }
});

server.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
