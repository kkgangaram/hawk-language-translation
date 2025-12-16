const express = require('express');
const bodyParser = require('body-parser');
const { BigQuery } = require('@google-cloud/bigquery');
const path = require('path');

const app = express();
const port = process.env.PORT || 8080;

// Middleware
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

// BigQuery Client
const bigquery = new BigQuery();

// Configuration - REPLACE WITH ACTUAL VALUES or use environment variables
const DATASET_ID = process.env.DATASET_ID || 'chat_dataset';
const TABLE_ID = process.env.TABLE_ID || 'messages';

// Helper to ensure table exists
async function ensureDatasetAndTableExists() {
    try {
        // Assumption: DATASET_ID already exists. We only check/create the table.


        // Check/Create Table
        const [tableExists] = await bigquery.dataset(DATASET_ID).table(TABLE_ID).exists();
        if (!tableExists) {
            console.log(`Table ${TABLE_ID} not found. Creating...`);
            const schema = [
                { name: 'conversationid', type: 'STRING' },
                { name: 'message', type: 'STRING' },
                { name: 'timestamp', type: 'TIMESTAMP' }
            ];
            await bigquery.dataset(DATASET_ID).createTable(TABLE_ID, { schema });
            console.log(`Table ${TABLE_ID} created with schema.`);
        } else {
            console.log(`Table ${TABLE_ID} already exists.`);
        }
    } catch (error) {
        console.error('ERROR ensuring BigQuery resources:', error);
    }
}

// Save Message Endpoint
app.post('/api/save', async (req, res) => {
    try {
        const { conversationId, message } = req.body;
        console.log('Received message:', { conversationId, message });

        if (!conversationId || !message) {
            return res.status(400).send('Missing conversationId or message');
        }

        const rows = [
            { conversationid: conversationId, message, timestamp: new BigQuery().timestamp(new Date()) }
        ];

        await bigquery
            .dataset(DATASET_ID)
            .table(TABLE_ID)
            .insert(rows);

        console.log(`Inserted 1 row`);
        res.status(200).send('Message saved');
    } catch (error) {
        console.error('ERROR:', error);
        res.status(500).send(error.message);
    }
});

// Get History Endpoint
app.get('/api/history', async (req, res) => {
    try {
        const { conversationId } = req.query;
        console.log('Fetching history for:', conversationId);

        if (!conversationId) {
            return res.status(400).send('Missing conversationId endpoint');
        }

        const query = `
            SELECT message, timestamp
            FROM \`${DATASET_ID}.${TABLE_ID}\`
            WHERE conversationid = @conversationId
            ORDER BY timestamp ASC
        `;

        const options = {
            query: query,
            params: { conversationId },
        };

        const [rows] = await bigquery.query(options);

        res.status(200).json(rows);
    } catch (error) {
        console.error('ERROR:', error);
        res.status(500).send(error.message);
    }
});

app.listen(port, async () => {
    await ensureDatasetAndTableExists();
    console.log(`Server running on port ${port}`);
});
