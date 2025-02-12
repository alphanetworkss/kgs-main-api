const express = require('express');
const axios = require('axios');
const { MongoClient } = require('mongodb');

const app = express();
app.use(express.json());
const port = 3000;

const mongoURI = 'mongodb+srv://maxstudy:FR13NDSclay@cluster0.g16a8.mongodb.net/?retryWrites=true&w=majority';
const dbName = 'KGS';
const collectionName = 'batches';
const subjectCollectionName = 'subjects';
const lessonCollectionName = 'lessons'; // New collection for lessons


app.get('/subjects/:courseId', async (req, res) => {
    const { courseId } = req.params;
    try {
        const client = new MongoClient(mongoURI);
        await client.connect();
        const db = client.db(dbName);
        const subjectCollection = db.collection(subjectCollectionName);

        const subjects = await subjectCollection.find({ courseId: parseInt(courseId) }).toArray();

        await client.close();
        res.json(subjects);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/lessons/:subjectId', async (req, res) => {
    const { subjectId } = req.params;
    try {
        const client = new MongoClient(mongoURI);
        await client.connect();
        const db = client.db(dbName);
        const lessonCollection = db.collection(lessonCollectionName);

        const lessons = await lessonCollection.find({ subjectId: parseInt(subjectId) }).toArray();

        await client.close();
        res.json(lessons);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/get-courses', async (req, res) => {
    try {
        const client = new MongoClient(mongoURI);
        await client.connect();
        const db = client.db(dbName);
        const collection = db.collection(collectionName);

        const courses = await collection.find({}, { projection: { accessToken: 0 } }).toArray();
        await client.close();

        res.json({ courses });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
});