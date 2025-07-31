import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Initialize database
export async function initializeDatabase() {
    const dbPath = path.join(__dirname, '..', '..', 'leaderboard.db');
    
    const db = await open({
        filename: dbPath,
        driver: sqlite3.Database
    });

    // Create scores table
    await db.exec(`
        CREATE TABLE IF NOT EXISTS scores (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            score INTEGER NOT NULL,
            gpu TEXT,
            cpuCores INTEGER,
            os TEXT,
            browser TEXT,
            browserVersion TEXT,
            memory INTEGER,
            screenResolution TEXT,
            architecture TEXT,
            date TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);

    // Create indexes for better performance
    await db.exec(`
        CREATE INDEX IF NOT EXISTS idx_scores_score ON scores(score DESC);
        CREATE INDEX IF NOT EXISTS idx_scores_date ON scores(date DESC);
        CREATE INDEX IF NOT EXISTS idx_scores_gpu ON scores(gpu);
        CREATE INDEX IF NOT EXISTS idx_scores_cpu ON scores(cpuCores);
    `);

    return db;
}

// Insert a new score
export async function insertScore(db, scoreData) {
    const { name, score, system, date } = scoreData;
    
    const result = await db.run(
        `INSERT INTO scores (
            name, score, gpu, cpuCores, os, browser, browserVersion, 
            memory, screenResolution, architecture, date
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
            name, score,
            system.gpu || null,
            system.cpuCores || null,
            system.os || null,
            system.browser || null,
            system.browserVersion || null,
            system.memory || null,
            system.screenResolution || null,
            system.architecture || null,
            date
        ]
    );
    
    return result.lastID;
}

// Get top scores
export async function getTopScores(db, limit = 10) {
    const scores = await db.all(`
        SELECT *, 
               ROW_NUMBER() OVER (ORDER BY score DESC) as rank
        FROM scores 
        ORDER BY score DESC 
        LIMIT ?
    `, [limit]);
    
    return scores;
}

// Get score by ID
export async function getScoreById(db, id) {
    const score = await db.get(`
        SELECT *, 
               ROW_NUMBER() OVER (ORDER BY score DESC) as rank
        FROM scores 
        WHERE id = ?
    `, [id]);
    
    return score;
}

// Get scores by GPU
export async function getScoresByGpu(db, gpu, limit = 10) {
    const scores = await db.all(`
        SELECT *, 
               ROW_NUMBER() OVER (ORDER BY score DESC) as rank
        FROM scores 
        WHERE gpu = ?
        ORDER BY score DESC 
        LIMIT ?
    `, [gpu, limit]);
    
    return scores;
}

// Get scores by CPU cores
export async function getScoresByCpuCores(db, cpuCores, limit = 10) {
    const scores = await db.all(`
        SELECT *, 
               ROW_NUMBER() OVER (ORDER BY score DESC) as rank
        FROM scores 
        WHERE cpuCores = ?
        ORDER BY score DESC 
        LIMIT ?
    `, [cpuCores, limit]);
    
    return scores;
}

// Get statistics
export async function getStatistics(db) {
    const stats = await db.get(`
        SELECT 
            COUNT(*) as totalScores,
            AVG(score) as averageScore,
            MAX(score) as highestScore,
            MIN(score) as lowestScore,
            COUNT(DISTINCT gpu) as uniqueGpus,
            COUNT(DISTINCT os) as uniqueOses
        FROM scores
    `);
    
    return stats;
}