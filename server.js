import express from 'express';
import cors from 'cors';
import path from 'path';
import { initializeDatabase, insertScore, getTopScores, getStatistics } from './src/core/database.js';

const DEBUG_LEADERBOARD = false;

const app = express();
const port = 3000;
let db;

// Middleware
app.use(cors());
app.use(express.json());

// Initialize database
async function init() {
    try {
        db = await initializeDatabase();
        console.log('Database initialized successfully');
    } catch (error) {
        console.error('Failed to initialize database:', error);
        process.exit(1);
    }
}

// GET /leaderboard - Retrieve top scores
app.get('/leaderboard', async (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 10;
        const scores = await getTopScores(db, Math.min(limit, 100)); // Cap at 100

        if (DEBUG_LEADERBOARD) {
            console.log('[Leaderboard][server][GET] top scores:', scores);
        }

        res.json(scores);
    } catch (error) {
        console.error('Error fetching leaderboard:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// POST /leaderboard - Submit a new score
app.post('/leaderboard', async (req, res) => {
    try {
        const newScore = req.body;

        if (DEBUG_LEADERBOARD) {
            console.log('[Leaderboard][server][POST] incoming body:', JSON.stringify(newScore));
        }

        // Basic validation
        if (
            !newScore ||
            typeof newScore.name !== 'string' ||
            !newScore.system ||
            typeof newScore.score !== 'number' ||
            !Number.isFinite(newScore.score) ||
            newScore.score <= 0
        ) {
            return res.status(400).json({ message: 'Invalid score data' });
        }

        newScore.date = new Date().toISOString().split('T')[0]; // Add date

        const scoreId = await insertScore(db, newScore);

        // Get the rank of the newly inserted score
        const insertedScore = await db.get(`
            SELECT *,
                   ROW_NUMBER() OVER (ORDER BY score DESC) as rank
            FROM scores
            WHERE id = ?
        `, [scoreId]);

        res.status(201).json({
            message: 'Score submitted successfully',
            rank: insertedScore.rank,
            id: scoreId
        });
    } catch (error) {
        console.error('Error submitting score:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// GET /leaderboard - debug listing hook
app.get('/leaderboard', async (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 10;
        const scores = await getTopScores(db, Math.min(limit, 100)); // Cap at 100

        if (DEBUG_LEADERBOARD) {
            console.log('[Leaderboard][server][GET] top scores:', scores);
        }

        res.json(scores);
    } catch (error) {
        console.error('Error fetching leaderboard:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// GET /leaderboard/stats - Get leaderboard statistics
app.get('/leaderboard/stats', async (req, res) => {
    try {
        const stats = await getStatistics(db);
        res.json(stats);
    } catch (error) {
        console.error('Error fetching statistics:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// GET /leaderboard/gpu/:gpu - Get scores for specific GPU
app.get('/leaderboard/gpu/:gpu', async (req, res) => {
    try {
        const gpu = req.params.gpu;
        const limit = parseInt(req.query.limit) || 10;
        const scores = await db.all(`
            SELECT *,
                   ROW_NUMBER() OVER (ORDER BY score DESC) as rank
            FROM scores
            WHERE gpu = ?
            ORDER BY score DESC
            LIMIT ?
        `, [gpu, Math.min(limit, 100)]);
        
        res.json(scores);
    } catch (error) {
        console.error('Error fetching GPU scores:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// GET /leaderboard/cpu/:cores - Get scores for specific CPU core count
app.get('/leaderboard/cpu/:cores', async (req, res) => {
    try {
        const cores = parseInt(req.params.cores);
        const limit = parseInt(req.query.limit) || 10;
        const scores = await db.all(`
            SELECT *,
                   ROW_NUMBER() OVER (ORDER BY score DESC) as rank
            FROM scores
            WHERE cpuCores = ?
            ORDER BY score DESC
            LIMIT ?
        `, [cores, Math.min(limit, 100)]);
        
        res.json(scores);
    } catch (error) {
        console.error('Error fetching CPU scores:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// GET /leaderboard/:id - Get specific score by ID
app.get('/leaderboard/score/:id', async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const score = await db.get(`
            SELECT *,
                   ROW_NUMBER() OVER (ORDER BY score DESC) as rank
            FROM scores
            WHERE id = ?
        `, [id]);
        
        if (!score) {
            return res.status(404).json({ message: 'Score not found' });
        }
        
        res.json(score);
    } catch (error) {
        console.error('Error fetching score:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// Start server
init().then(() => {
    app.listen(port, () => {
        console.log(`Server listening at http://localhost:${port}`);
    });
}).catch(error => {
    console.error('Failed to start server:', error);
    process.exit(1);
});