const express = require('express');
const axios = require('axios');
const cors = require('cors');
const { MongoClient } = require('mongodb');

const app = express();
app.use(express.json());

// Allowed origins for CORS
const allowedOrigins = [
  'https://shadowlink.site',
  'https://alphacbse.site',
  'https://alphacbse.ratna.pw',
  'https://maxstudy.site'
];

app.use(cors({
  origin: function (origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true
}));

// Optional: Catch CORS errors
app.use((err, req, res, next) => {
  if (err.message === 'Not allowed by CORS') {
    return res.status(403).json({ error: 'CORS policy blocked this request.' });
  }
  next(err);
});

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
        // Validate the access token immediately
        const testResponse = await axios.get('https://api.khanglobalstudies.com/cms/user/v2/courses', {
            headers: { Authorization: `Bearer ${accessToken}` }
        });

        // If token is valid, start processing
        res.json({ message: 'Processing started. Check server logs for completion status.' });

        // Start background processing
        processStoreCourses(accessToken).catch(error => {
            console.error('Background processing error:', error);
        });

    } catch (error) {
        // Handle authentication errors
        if (error.response?.status === 401) {
            return res.status(401).json({
                error: 'Unauthenticated. Please check your Phone Number / Password or token and try again.'
            });
        }
        // Handle other errors
        res.status(500).json({ error: error.message });
    }
});

async function processStoreCourses(accessToken) {
    const client = new MongoClient(mongoURI);
    try {
        await client.connect();
        const db = client.db(dbName);
        const collection = db.collection(collectionName);
        const subjectCollection = db.collection(subjectCollectionName);
        const lessonCollection = db.collection(lessonCollectionName);

        // Fetch courses from the API
        const response = await axios.get('https://api.khanglobalstudies.com/cms/user/v2/courses', {
            headers: { Authorization: `Bearer ${accessToken}` }
        });

        if (!Array.isArray(response.data)) {
            throw new Error('Unexpected API response format');
        }

        // Process each course
        for (const course of response.data) {
            const existingCourse = await collection.findOne({ id: course.id });

            if (existingCourse) {
                // Update existing course if accessToken is missing
                if (!existingCourse.accessToken) {
                    await collection.updateOne(
                        { id: course.id },
                        {
                            $set: {
                                title: course.title,
                                image: course.image.large,
                                accessToken,
                                updatedAt: new Date()
                            }
                        }
                    );
                    console.log(`Updated course: ${course.title} (ID: ${course.id})`);
                } else {
                    console.log(`Course already exists: ${course.title} (ID: ${course.id})`);
                }
            } else {
                // Insert new course
                await collection.insertOne({
                    id: course.id,
                    title: course.title,
                    image: course.image.large,
                    accessToken,
                    updatedAt: new Date()
                });
                console.log(`Added new course: ${course.title} (ID: ${course.id})`);
            }

            // Fetch and process subjects for the course
            const subjectResponse = await axios.get(`https://api.khanglobalstudies.com/cms/user/courses/${course.id}/v2-lessons`, {
                headers: { Authorization: `Bearer ${accessToken}` }
            });

            if (Array.isArray(subjectResponse.data)) {
                for (const subject of subjectResponse.data) {
                    // Update or insert subject
                    await subjectCollection.updateOne(
                        { id: subject.id, courseId: course.id },
                        {
                            $set: {
                                name: subject.name,
                                videos: subject.videos,
                                updatedAt: new Date()
                            }
                        },
                        { upsert: true }
                    );
                    console.log(`Processed subject: ${subject.name} (ID: ${subject.id}) for course ID: ${course.id}`);

                    // Fetch and process lessons for the subject
                    const lessonResponse = await axios.get(`https://api.khanglobalstudies.com/cms/lessons/${subject.id}`, {
                        headers: { Authorization: `Bearer ${accessToken}` }
                    });

                    if (lessonResponse.data?.videos) {
                        for (const video of lessonResponse.data.videos) {
                            // Handle PDFs
                            let pdfData = null;
                            if (video.pdfs && (video.pdfs.title !== null || video.pdfs.url !== null)) {
                                pdfData = {
                                    title: video.pdfs.title,
                                    url: video.pdfs.url
                                };
                                if (pdfData.title === null && pdfData.url === null) {
                                    pdfData = null;
                                }
                            }

                            // Update or insert lesson
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
                                        pdfs: pdfData,
                                        subjectId: subject.id,
                                        courseId: course.id,
                                        updatedAt: new Date()
                                    }
                                },
                                { upsert: true }
                            );
                            console.log(`Processed lesson video: ${video.name} (ID: ${video.id}) for subject ID: ${subject.id}`);
                        }
                    }
                }
            }
        }

        console.log('All courses, subjects, and lessons processed successfully');
    } catch (error) {
        console.error('Error during processing:', error);

        // Handle unauthorized errors
        if (error.response?.status === 401) {
            const db = client.db(dbName);
            const collection = db.collection(collectionName);
            await collection.updateMany(
                { accessToken },
                { $unset: { accessToken: 1 } }
            );
            console.log('Invalid access token removed from all courses');
        }
    } finally {
        await client.close();
    }
}

app.get('/update/:id', async (req, res) => {
    const { id } = req.params;
    const client = new MongoClient(mongoURI);

    try {
        await client.connect();
        const db = client.db(dbName);
        const collection = db.collection(collectionName);

        // Immediate check for batch existence
        const existingBatch = await collection.findOne({ id: parseInt(id) });
        if (!existingBatch) {
            return res.status(404).json({ error: 'Batch not found' });
        }

        // Immediate access token check
        if (!existingBatch.accessToken) {
            return res.status(403).json({ 
                error: 'I am not able to update this batch. Please update by logging in.' 
            });
        }

        // Immediate cooldown check
        if (existingBatch.updatedAt) {
            const lastUpdated = new Date(existingBatch.updatedAt);
            const hoursDiff = (Date.now() - lastUpdated) / (1000 * 60 * 60);
            
            if (hoursDiff < 18) {
                const remaining = (18 - hoursDiff).toFixed(1);
                return res.status(429).json({
                    error: `Please wait ${remaining} hours before updating again.`
                });
            }
        }

        // Immediate token validation
        try {
            await axios.get('https://api.khanglobalstudies.com/cms/user/v2/courses', {
                headers: { Authorization: `Bearer ${existingBatch.accessToken}` }
            });
        } catch (error) {
            if (error.response?.status === 401) {
                await collection.updateOne(
                    { id: parseInt(id) },
                    { $unset: { accessToken: 1 } }
                );
                return res.status(401).json({
                    error: 'I am not able to update this batch. Please update by logging in.'
                });
            }
            throw error;
        }

        // Start background processing if all checks pass
        res.json({ message: 'Update process started. Check server logs for status.' });
        processUpdate(id).catch(error => {
            console.error('Background update error:', error);
        });

    } catch (error) {
        res.status(500).json({ error: error.message });
    } finally {
        await client.close();
    }
});

async function processUpdate(id) {
    const client = new MongoClient(mongoURI);
    try {
        await client.connect();
        const db = client.db(dbName);
        const collection = db.collection(collectionName);
        const subjectCollection = db.collection(subjectCollectionName);
        const lessonCollection = db.collection(lessonCollectionName);

        const existingBatch = await collection.findOne({ id: parseInt(id) });
        const accessToken = existingBatch.accessToken;

        // Fetch updated course data
        const response = await axios.get('https://api.khanglobalstudies.com/cms/user/v2/courses', {
            headers: { Authorization: `Bearer ${accessToken}` }
        });

        const updatedCourse = response.data.find(course => course.id === parseInt(id));
        if (!updatedCourse) {
            throw new Error('Course data not found in API response');
        }

        // Update course information
        await collection.updateOne(
            { id: parseInt(id) },
            { $set: { 
                title: updatedCourse.title,
                image: updatedCourse.image.large,
                updatedAt: new Date() 
            }}
        );

        // Process subjects
        const subjectResponse = await axios.get(
            `https://api.khanglobalstudies.com/cms/user/courses/${id}/v2-lessons`,
            { headers: { Authorization: `Bearer ${accessToken}` } }
        );

        for (const subject of subjectResponse.data) {
            // Update subject
            await subjectCollection.updateOne(
                { id: subject.id, courseId: parseInt(id) },
                { $set: { 
                    name: subject.name,
                    videos: subject.videos,
                    updatedAt: new Date() 
                }},
                { upsert: true }
            );

            // Process lessons
            const lessonResponse = await axios.get(
                `https://api.khanglobalstudies.com/cms/lessons/${subject.id}`,
                { headers: { Authorization: `Bearer ${accessToken}` } }
            );

            for (const video of lessonResponse.data?.videos || []) {
                // Process PDFs
                const pdfData = video.pdfs?.filter(pdf => 
                    pdf.title || pdf.url
                ) || null;

                await lessonCollection.updateOne(
                    { id: video.id, subjectId: subject.id, courseId: parseInt(id) },
                    { $set: {
                        thumb: video.thumb,
                        name: video.name,
                        video_url: video.video_url,
                        hd_video_url: video.hd_video_url,
                        published_at: video.published_at,
                        pdfs: pdfData,
                        updatedAt: new Date()
                    }},
                    { upsert: true }
                );
            }
        }

        console.log(`Successfully updated batch ${id}`);
    } catch (error) {
        console.error(`Error updating batch ${id}:`, error);
        
        // Handle unauthorized errors during processing
        if (error.response?.status === 401) {
            await collection.updateOne(
                { id: parseInt(id) },
                { $unset: { accessToken: 1 } }
            );
            console.log(`Removed invalid token for batch ${id}`);
        }
    } finally {
        await client.close();
    }
}

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
