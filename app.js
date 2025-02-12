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

app.get('/store-courses', async (req, res) => {
    const accessToken = req.query.token;
    if (!accessToken) {
        return res.status(400).json({ error: 'Access token is required' });
    }

    try {
        const response = await axios.get('https://api.khanglobalstudies.com/cms/user/v2/courses', {
            headers: { Authorization: `Bearer ${accessToken}` }
        });

        if (!Array.isArray(response.data)) {
            return res.status(500).json({ error: 'Unexpected API response format' });
        }

        const client = new MongoClient(mongoURI);
        await client.connect();
        const db = client.db(dbName);
        const collection = db.collection(collectionName);
        const subjectCollection = db.collection(subjectCollectionName);
        const lessonCollection = db.collection(lessonCollectionName); // New collection

        for (const course of response.data) {
            const existingCourse = await collection.findOne({ id: course.id });
            if (existingCourse) {
                if (existingCourse.accessToken) {
                    console.log(`Batch with ID ${course.id} already exists and is up-to-date.`);
                    continue;
                } else {
                    await collection.updateOne(
                        { id: course.id },
                        { $set: { title: course.title, image: course.image.large, accessToken, updatedAt: new Date() } }
                    );
                    console.log(`Batch with ID ${course.id} existed but was missing accessToken, updated now.`);
                }
            } else {
                await collection.insertOne({
                    id: course.id,
                    title: course.title,
                    image: course.image.large,
                    accessToken,
                    updatedAt: new Date()
                });
                console.log(`Added new batch: ${course.title} (ID: ${course.id})`);
            }

            const subjectResponse = await axios.get(`https://api.khanglobalstudies.com/cms/user/courses/${course.id}/v2-lessons`, {
                headers: { Authorization: `Bearer ${accessToken}` }
            });
            if (Array.isArray(subjectResponse.data)) {
                for (const subject of subjectResponse.data) {
                    await subjectCollection.updateOne(
                        { id: subject.id, courseId: course.id },
                        { $set: { name: subject.name, videos: subject.videos, updatedAt: new Date() } },
                        { upsert: true }
                    );
                    console.log(`Stored subject: ${subject.name} (ID: ${subject.id}) for course ID: ${course.id}`);

                    // Fetch and store lesson data for this subject
                    const lessonResponse = await axios.get(`https://api.khanglobalstudies.com/cms/lessons/${subject.id}`, {
                        headers: { Authorization: `Bearer ${accessToken}` }
                    });

                    if (lessonResponse.data && lessonResponse.data.videos) {
                        for (const video of lessonResponse.data.videos) {
                            // Handle PDFs
                            let pdfData = null;
                            if (video.pdfs && (video.pdfs.title !== null || video.pdfs.url !== null)) {
                                pdfData = {
                                    title: video.pdfs.title,
                                    url: video.pdfs.url
                                };
                                // If both title and url are null, set pdfData to null
                                if (pdfData.title === null && pdfData.url === null) {
                                    pdfData = null;
                                }
                            }

                            await lessonCollection.updateOne(
                                { id: video.id, subjectId: subject.id, courseId: course.id },
                                {
                                    $set: {
                                        id: video.id,
                                        thumb: video.thumb,
                                        name: video.name,
                                        video_url: video.video_url,
                                        hd_video_url: video.hd_video_url,
                                        published_at: video.published_at,
                                        pdfs: pdfData, // Store PDF data or null
                                        subjectId: subject.id,
                                        courseId: course.id,
                                        updatedAt: new Date()
                                    }
                                },
                                { upsert: true }
                            );
                            console.log(`Stored lesson video: ${video.name} (ID: ${video.id}) for subject ID: ${subject.id}`);
                        }
                    }
                }
            }
        }

        await client.close();
        res.json({ message: 'Courses, subjects, and lessons processed successfully' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/update/:id', async (req, res) => {
    const { id } = req.params;
    try {
        const client = new MongoClient(mongoURI);
        await client.connect();
        const db = client.db(dbName);
        const collection = db.collection(collectionName);
        const subjectCollection = db.collection(subjectCollectionName);
        const lessonCollection = db.collection(lessonCollectionName);

        const existingBatch = await collection.findOne({ id: parseInt(id) });
        if (!existingBatch) {
            await client.close();
            return res.status(404).json({ error: 'Batch not found' });
        }

        let accessToken = existingBatch.accessToken;
        if (!accessToken) {
            await client.close();
            return res.status(403).json({ error: 'Access token not found for this batch' });
        }

        // Rate-limiting logic (existing code)
        if (existingBatch.updatedAt) {
            const lastUpdatedAt = new Date(existingBatch.updatedAt);
            const now = new Date();
            const hoursDiff = (now - lastUpdatedAt) / (1000 * 60 * 60);
            const remainingTime = Math.max(0, 18 - hoursDiff);

            if (hoursDiff < 18) {
                await client.close();
                return res.status(429).json({
                    message: `This batch was updated recently. Please wait ${remainingTime.toFixed(2)} hours before updating again.`
                });
            }
        }

        try {
            const response = await axios.get('https://api.khanglobalstudies.com/cms/user/v2/courses', {
                headers: { Authorization: `Bearer ${accessToken}` }
            });

            if (!Array.isArray(response.data)) {
                await client.close();
                return res.status(500).json({ error: 'Unexpected API response format' });
            }

            const updatedCourse = response.data.find(course => course.id === parseInt(id));
            if (!updatedCourse) {
                await client.close();
                return res.status(404).json({ error: 'Updated course data not found' });
            }

            await collection.updateOne(
                { id: parseInt(id) },
                { $set: { title: updatedCourse.title, image: updatedCourse.image.large, updatedAt: new Date() } }
            );
            console.log(`Updated batch: ${updatedCourse.title} (ID: ${updatedCourse.id})`);

            const subjectResponse = await axios.get(`https://api.khanglobalstudies.com/cms/user/courses/${id}/v2-lessons`, {
                headers: { Authorization: `Bearer ${accessToken}` }
            });

            if (Array.isArray(subjectResponse.data)) {
                for (const subject of subjectResponse.data) {
                    await subjectCollection.updateOne(
                        { id: subject.id, courseId: parseInt(id) },
                        { $set: { name: subject.name, videos: subject.videos, updatedAt: new Date() } },
                        { upsert: true }
                    );
                    console.log(`Updated subject: ${subject.name} (ID: ${subject.id}) for course ID: ${id}`);

                    // Fetch lesson data for this subject
                    const lessonResponse = await axios.get(`https://api.khanglobalstudies.com/cms/lessons/${subject.id}`, {
                        headers: { Authorization: `Bearer ${accessToken}` }
                    });

                    if (lessonResponse.data && lessonResponse.data.videos) {
                        for (const video of lessonResponse.data.videos) {
                            // Handle PDFs array
                            let pdfData = null;
                            if (video.pdfs && Array.isArray(video.pdfs)) {
                                // Filter out PDF entries with both title and URL as null
                                const validPDFs = video.pdfs
                                    .map(pdf => ({
                                        title: pdf.title || null,
                                        url: pdf.url || null
                                    }))
                                    .filter(pdf => pdf.title !== null || pdf.url !== null);

                                // Set pdfData to null if no valid PDFs remain
                                pdfData = validPDFs.length > 0 ? validPDFs : null;
                            }

                            await lessonCollection.updateOne(
                                { id: video.id, subjectId: subject.id, courseId: parseInt(id) },
                                {
                                    $set: {
                                        id: video.id,
                                        thumb: video.thumb,
                                        name: video.name,
                                        video_url: video.video_url,
                                        hd_video_url: video.hd_video_url,
                                        published_at: video.published_at,
                                        pdfs: pdfData, // Now properly handles arrays
                                        subjectId: subject.id,
                                        courseId: parseInt(id),
                                        updatedAt: new Date()
                                    }
                                },
                                { upsert: true }
                            );
                            console.log(`Updated lesson video: ${video.name} (ID: ${video.id}) for subject ID: ${subject.id}`);
                        }
                    }
                }
            }

            await client.close();
            res.json({ message: 'Batch, subjects, and lessons updated successfully' });
        } catch (error) {
            if (error.response && error.response.status === 401) {
                await collection.updateOne(
                    { id: parseInt(id) },
                    { $unset: { accessToken: 1 } }
                );
                console.log(`Access token removed for batch ID: ${id} due to authentication failure.`);
                return res.status(401).json({ error: 'Unauthorized, access token removed' });
            }
            res.status(500).json({ error: error.message });
        }
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

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