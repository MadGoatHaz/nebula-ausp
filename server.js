import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';

const app = express();
const port = 3000;
const leaderboardDataPath = path.join(process.cwd(), 'leaderboard-data.json');

// Middleware
app.use(cors());
app.use(express.json());

// Function to read leaderboard data from file
const readLeaderboardData = () => {
    try {
        const data = fs.readFileSync(leaderboardDataPath, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        // If the file doesn't exist or is invalid, return a default structure
        return [
            { rank: 1, name: 'MadGoat', score: 9550, system: { gpu: 'RTX 4090', cpuCores: 24 }, date: '2024-01-01' },
            { rank: 2, name: 'AI_Dev', score: 9200, system: { gpu: 'RTX 4080', cpuCores: 16 }, date: '2024-01-02' },
            { rank: 3, name: 'TinkerTom', score: 8800, system: { gpu: 'RX 7900 XTX', cpuCores: 12 }, date: '2024-01-03' },
        ];
    }
};

// Function to write leaderboard data to file
const writeLeaderboardData = (data) => {
    fs.writeFileSync(leaderboardDataPath, JSON.stringify(data, null, 2), 'utf8');
};

// GET /leaderboard - Retrieve top 10 scores
app.get('/leaderboard', (req, res) => {
    const data = readLeaderboardData();
    res.json(data.slice(0, 10)); // Return only top 10
});

// POST /leaderboard - Submit a new score
app.post('/leaderboard', (req, res) => {
    const newScore = req.body;
    const leaderboard = readLeaderboardData();

    // Basic validation
    if (!newScore || typeof newScore.score !== 'number' || typeof newScore.name !== 'string' || !newScore.system) {
        return res.status(400).json({ message: 'Invalid score data' });
    }

    newScore.date = new Date().toISOString().split('T')[0]; // Add date

    leaderboard.push(newScore);
    leaderboard.sort((a, b) => b.score - a.score); // Sort descending
    leaderboard.forEach((entry, index) => {
        entry.rank = index + 1; // Re-assign ranks
    });

    writeLeaderboardData(leaderboard);

    res.status(201).json({ message: 'Score submitted successfully', rank: newScore.rank });
});

app.listen(port, () => {
    console.log(`Server listening at http://localhost:${port}`);
    // Initialize leaderboard data if it doesn't exist
    if (!fs.existsSync(leaderboardDataPath)) {
        writeLeaderboardData(readLeaderboardData());
    }
}); 